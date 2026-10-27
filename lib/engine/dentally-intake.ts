import { safeEqual } from "@/lib/api/auth";
import type { Json } from "@/lib/database.types";
import { DentallyError, type DentallyClient } from "@/lib/dentally/client";
import { isCancelledAppointment, normaliseAppointment, type NormalisedCancellation } from "@/lib/dentally/normalise";
import { readDoctors } from "@/lib/doctors";
import { nowOf, type ClinicRow, type ConfigRow, type EngineDeps } from "@/lib/engine/context";
import { ingestCancellation } from "@/lib/engine/intake";
import { startOffers } from "@/lib/engine/offer";
import { getState, setState } from "@/lib/engine/state";

// Dentally intake: webhook and poller. Source: SYSTEM_BUILD_GUIDE.md §7 E2.
// Both end in ingestCancellation(), which is idempotent on pms_appointment_id, so overlap is safe.

export type DentallyClinic = { clinic: ClinicRow; config: ConfigRow };

/** One isolated system per clinic (guide §13): the active clinic of this deployment. */
export async function loadDentallyClinic(deps: EngineDeps): Promise<DentallyClinic | null> {
  const { data: clinic } = await deps.db
    .from("clinics")
    .select("*")
    .eq("is_active", true)
    .eq("pms_type", "dentally")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!clinic) return null;
  const { data: config } = await deps.db.from("clinic_config").select("*").eq("clinic_id", clinic.id).maybeSingle();
  return config ? { clinic, config } : null;
}

export type IngestOutcome = "ingested" | "duplicate" | "ignored_not_cancelled" | "ignored_past" | "ignored_unusable";

async function alreadyIngested(deps: EngineDeps, clinicId: string, appointmentId: string): Promise<boolean> {
  const { data } = await deps.db
    .from("cancellation_events")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("pms_source", "dentally")
    .eq("pms_appointment_id", appointmentId)
    .maybeSingle();
  return Boolean(data);
}

async function ingestNormalised(deps: EngineDeps, dc: DentallyClinic, n: NormalisedCancellation, note: string): Promise<IngestOutcome> {
  const now = nowOf(deps);
  if (n.slotDatetime.getTime() <= now.getTime()) return "ignored_past"; // nothing to recover, so no card
  const result = await ingestCancellation(deps.db, {
    clinicId: dc.clinic.id,
    clinicTimezone: dc.clinic.timezone,
    config: dc.config,
    slotDatetime: n.slotDatetime,
    slotDurationMinutes: n.slotDurationMinutes,
    procedureType: n.procedureType,
    doctorId: n.doctorId,
    doctorName: n.doctorName,
    cancelledPatientName: n.cancelledPatientName,
    cancelledPatientEmail: n.cancelledPatientEmail,
    cancelledPatientPhone: n.cancelledPatientPhone,
    cancellationReason: n.cancellationReason,
    pmsSource: "dentally",
    pmsAppointmentId: n.pmsAppointmentId,
    rawPayload: n.rawPayload as Json,
    triggeredBy: "system",
    logNote: note,
    now,
  });
  if (result.duplicate) return "duplicate";
  if (result.shouldStartOffers) {
    try {
      await startOffers(deps, result.pipelineId);
    } catch (error) {
      // The card exists; the tick's self-heal will start the offers.
      console.error("startOffers failed:", error instanceof Error ? error.message : error);
    }
  }
  return "ingested";
}

/** Fetch patient and practitioner details (best effort: a failure here must not lose the cancellation). */
async function enrich(client: DentallyClient, appt: Record<string, unknown>, practitioners: Map<string, string>) {
  let patient: Record<string, unknown> | null = null;
  const patientId = appt.patient_id;
  if (typeof patientId === "string" || typeof patientId === "number") {
    try {
      patient = await client.getPatient(String(patientId));
    } catch (error) {
      console.error("Dentally patient lookup failed:", error instanceof DentallyError ? error.status : "error");
    }
  }
  const practitionerName = appt.practitioner_id != null ? (practitioners.get(String(appt.practitioner_id)) ?? null) : null;
  return { patient, practitionerName };
}

async function practitionerNames(client: DentallyClient): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    for (const p of await client.listPractitioners()) {
      const id = p.id != null ? String(p.id) : null;
      const name = [p.first_name, p.last_name].filter((x) => typeof x === "string" && x).join(" ") || (typeof p.name === "string" ? p.name : "");
      if (id && name) map.set(id, name);
    }
  } catch (error) {
    console.error("Dentally practitioner list failed:", error instanceof DentallyError ? error.status : "error");
  }
  return map;
}

/** One appointment that Dentally says is cancelled (or an appointment to check). */
export async function ingestAppointment(
  deps: EngineDeps,
  dc: DentallyClinic,
  client: DentallyClient,
  appt: Record<string, unknown>,
  practitioners: Map<string, string>,
  note = "Cancellation logged from Dentally",
): Promise<IngestOutcome> {
  if (!isCancelledAppointment(appt)) return "ignored_not_cancelled";
  const id = appt.id != null ? String(appt.id) : null;
  if (!id) return "ignored_unusable";
  if (await alreadyIngested(deps, dc.clinic.id, id)) return "duplicate";

  const { patient, practitionerName } = await enrich(client, appt, practitioners);
  const normalised = normaliseAppointment(appt, { doctors: readDoctors(dc.config.doctors), patient, practitionerName });
  if (!normalised) return "ignored_unusable";
  return ingestNormalised(deps, dc, normalised, note);
}

// ---- Webhook ----------------------------------------------------------------------------------

export type DentallyEvent = { action: "created" | "updated" | "deleted" | null; appointmentId: string | null; embedded: Record<string, unknown> | null };

/**
 * Read a webhook body. ASSUMED shape (confirm in the sandbox): an event name such as "appointment.updated"
 * (in `event`, `type` or `topic`), and the record under `appointment`, `data` or the body itself.
 * Only the appointment id is trusted: the appointment is always fetched again.
 */
export function parseDentallyEvent(payload: unknown): DentallyEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  const name = String(p.event ?? p.type ?? p.topic ?? p.action ?? "").toLowerCase();
  if (!name.includes("appointment")) return null;
  const action = name.includes("delet") ? "deleted" : name.includes("creat") ? "created" : name.includes("updat") ? "updated" : null;
  const candidate = p.appointment ?? p.data ?? p.record ?? (p.id ? p : null);
  const embedded = candidate && typeof candidate === "object" && !Array.isArray(candidate) ? (candidate as Record<string, unknown>) : null;
  const id = embedded?.id ?? p.appointment_id ?? p.resource_id ?? p.id;
  return { action, appointmentId: id != null ? String(id) : null, embedded };
}

export type WebhookInput = {
  secretFromPath: string;
  expectedSecret: string | null;
  payload: unknown;
  deps: EngineDeps;
  client: DentallyClient | null;
};

/** Auth, record that a webhook arrived, answer 200, and do the work afterwards (deps.defer). */
export async function handleDentallyWebhook(input: WebhookInput): Promise<{ status: 200 | 401 | 404 }> {
  const { secretFromPath, expectedSecret, payload, deps, client } = input;
  if (!expectedSecret) return { status: 404 };
  if (!safeEqual(secretFromPath, expectedSecret)) return { status: 401 };

  const dc = await loadDentallyClinic(deps);
  if (!dc) return { status: 200 };
  await setState(deps.db, dc.clinic.id, "last_webhook_at", nowOf(deps).toISOString());

  const work = async () => {
    try {
      const event = parseDentallyEvent(payload);
      if (!event?.appointmentId) return; // not an appointment event, or unreadable: ignore
      const names = client ? await practitionerNames(client) : new Map<string, string>();

      if (event.action === "deleted") {
        // Gone from Dentally, so it cannot be fetched. It counts only if the payload says the slot is in the future.
        if (!event.embedded) return;
        const n = normaliseAppointment({ ...event.embedded, id: event.appointmentId }, { doctors: readDoctors(dc.config.doctors) });
        if (n && !(await alreadyIngested(deps, dc.clinic.id, n.pmsAppointmentId))) {
          await ingestNormalised(deps, dc, n, "Cancellation logged from Dentally (appointment deleted)");
        }
        return;
      }

      if (!client) return;
      const appt = await client.getAppointment(event.appointmentId); // never trust the payload alone
      if (appt) await ingestAppointment(deps, dc, client, appt, names);
    } catch (error) {
      console.error("Dentally webhook work failed:", error instanceof Error ? error.message : error);
    }
  };

  if (deps.defer) deps.defer(work);
  else await work();
  return { status: 200 };
}

// ---- Poller -----------------------------------------------------------------------------------

export type PollSummary = { checked: number; ingested: number; error: string | null };

const OVERLAP_MS = 2 * 60_000;
const FIRST_POLL_LOOKBACK_MS = 15 * 60_000;

export async function runDentallyPoll(deps: EngineDeps, client: DentallyClient): Promise<PollSummary> {
  const now = nowOf(deps);
  const dc = await loadDentallyClinic(deps);
  if (!dc) return { checked: 0, ingested: 0, error: null };
  const clinicId = dc.clinic.id;

  const last = await getState<string>(deps.db, clinicId, "last_poll_at");
  const since = new Date((last ? new Date(last).getTime() - OVERLAP_MS : now.getTime() - FIRST_POLL_LOOKBACK_MS));

  try {
    const appointments = await client.listAppointments({ updatedSince: since });
    const names = await practitionerNames(client);
    let ingested = 0;
    for (const appt of appointments) {
      try {
        if ((await ingestAppointment(deps, dc, client, appt, names, "Cancellation logged from Dentally (poll)")) === "ingested") ingested += 1;
      } catch (error) {
        console.error("Dentally poll: one appointment failed:", error instanceof Error ? error.message : error);
      }
    }
    await setState(deps.db, clinicId, "last_poll_at", now.toISOString());
    await setState(deps.db, clinicId, "poll_failures", 0);
    if (appointments.length > 0) await setState(deps.db, clinicId, "last_poll_changes_at", now.toISOString());
    return { checked: appointments.length, ingested, error: null };
  } catch (error) {
    const failures = ((await getState<number>(deps.db, clinicId, "poll_failures")) ?? 0) + 1;
    await setState(deps.db, clinicId, "poll_failures", failures);
    const message = error instanceof DentallyError ? `Dentally ${error.status} ${error.type}` : "Dentally poll failed";
    console.error(message);
    return { checked: 0, ingested: 0, error: message };
  }
}
