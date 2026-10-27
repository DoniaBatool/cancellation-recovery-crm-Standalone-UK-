import type { Json } from "@/lib/database.types";
import type { Doctor } from "@/lib/validation";

// Dentally appointment -> our cancellation. Source: SYSTEM_BUILD_GUIDE.md §7 E2 "Normaliser".
//
// ASSUMED field names (confirm in the sandbox, see lib/dentally/client.ts). The reader accepts a few
// likely alternatives so a small difference does not break intake:
//   start: start_time | start     end: finish_time | end     practitioner: practitioner_id
//   reason: reason | cancellation_reason     treatment text: treatment_description | description | reason
//   cancelled: `cancelled` true, or `state` / `status` containing "cancel" (or "dna"/"failed" is NOT a cancellation)

export type NormalisedCancellation = {
  slotDatetime: Date;
  slotDurationMinutes: number;
  procedureType: string | null;
  doctorId: string | null;
  doctorName: string | null;
  cancelledPatientName: string | null;
  cancelledPatientEmail: string | null;
  cancelledPatientPhone: string | null;
  cancellationReason: string | null;
  pmsAppointmentId: string;
  rawPayload: Json;
};

type Raw = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);
const pick = (obj: Raw, ...keys: string[]): unknown => keys.map((k) => obj[k]).find((v) => v !== undefined && v !== null);

/** Keyword map from free text to our PROCEDURES. Unknown -> null (uses price_default, matches "any" patients). */
const KEYWORDS: [RegExp, string][] = [
  [/hygien|scale|polish|clean/i, "cleaning"],
  [/implant/i, "implant"],
  [/whiten|bleach/i, "whitening"],
  [/crown|bridge|veneer/i, "crown"],
  [/extract|wisdom|removal/i, "extraction"],
  [/fill|restor|composite|amalgam/i, "filling"],
  [/exam|check|consult|assessment|new patient/i, "consultation"],
];

export function mapProcedure(text: string | null | undefined): string | null {
  if (!text) return null;
  return KEYWORDS.find(([re]) => re.test(text))?.[1] ?? null;
}

/** Is this appointment cancelled? `deleted` is handled separately by the webhook. */
export function isCancelledAppointment(appt: Raw): boolean {
  if (appt.cancelled === true) return true;
  const state = String(pick(appt, "state", "status") ?? "").toLowerCase();
  return state.includes("cancel");
}

function dateOf(v: unknown): Date | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Returns null when the appointment cannot be used (no id or no valid start). */
export function normaliseAppointment(
  appt: Raw,
  opts: { doctors?: Doctor[]; patient?: Raw | null; practitionerName?: string | null } = {},
): NormalisedCancellation | null {
  const id = str(appt.id);
  const start = dateOf(pick(appt, "start_time", "start"));
  if (!id || !start) return null;

  const end = dateOf(pick(appt, "finish_time", "end"));
  const minutes = end ? Math.round((end.getTime() - start.getTime()) / 60_000) : 0;
  const duration = minutes >= 5 && minutes <= 480 ? minutes : 30;

  const practitionerId = str(appt.practitioner_id);
  const configured = practitionerId ? opts.doctors?.find((d) => d.id === practitionerId) : undefined;

  const reason = str(pick(appt, "cancellation_reason", "reason"));
  const treatmentText = str(pick(appt, "treatment_description", "description")) ?? reason;

  const patient = opts.patient ?? null;
  const first = patient ? str(patient.first_name) : null;
  const last = patient ? str(patient.last_name) : null;
  const name = [first, last].filter(Boolean).join(" ") || (patient ? str(patient.name) : null);

  return {
    slotDatetime: start,
    slotDurationMinutes: duration,
    procedureType: mapProcedure(treatmentText),
    doctorId: practitionerId,
    doctorName: configured?.name ?? opts.practitionerName ?? null,
    cancelledPatientName: name,
    cancelledPatientEmail: patient ? str(pick(patient, "email_address", "email")) : null,
    cancelledPatientPhone: patient ? str(pick(patient, "mobile_phone", "phone", "home_phone")) : null,
    cancellationReason: reason,
    pmsAppointmentId: id,
    rawPayload: appt as Json,
  };
}
