import { ApiError } from "@/lib/api/http";
import { clinicInfo, loadPipeline, nowOf, shortName, slotInfo, uuidOf, type EngineDeps, type Loaded } from "@/lib/engine/context";
import { offerNext, type OfferRun } from "@/lib/engine/offer";
import type { PatientInfo } from "@/lib/engine/notifier";
import { readDoctors } from "@/lib/doctors";
import { logHistory, transitionStage } from "@/lib/pipeline";

// Front-desk approval. Source: SYSTEM_BUILD_GUIDE.md §7 E6 and E7.
// Booking in the PMS is always manual (read-only token), so "approve" means: the slot is recovered,
// the revenue is counted, emails go out, and reception books it in Dentally and taps "Booked".

/** Who pressed the button. A Slack user has no CRM login, so approved_by stays null for them. */
export type ApprovalActor = { kind: "user"; userId: string; label: string } | { kind: "slack"; label: string };

async function loadPatient(deps: EngineDeps, patientId: string | null): Promise<PatientInfo | null> {
  if (!patientId) return null;
  const { data } = await deps.db.from("waitlist").select("id, patient_name, email, phone, sms_opt_out").eq("id", patientId).maybeSingle();
  return data ? { id: data.id, name: data.patient_name, email: data.email, phone: data.phone, smsOptOut: data.sms_opt_out } : null;
}

/** Patient said YES: tell reception (Slack or email) and remember how. The CRM card always shows it. */
export async function notifyReception(deps: EngineDeps, pipelineId: string, opts: { reminder?: boolean } = {}): Promise<void> {
  const loaded = await loadPipeline(deps.db, pipelineId);
  if (!loaded || loaded.pipeline.stage !== "waiting_staff_approval") return;
  const { pipeline, event, clinic, config } = loaded;
  const patient = await loadPatient(deps, pipeline.waitlist_patient_id);
  if (!patient || !pipeline.approval_token) return;

  let via: "slack" | "email" | null = null;
  let slackMessageTs: string | null | undefined;
  try {
    const result = await deps.notifier.receptionApproval({
      clinic: clinicInfo(clinic),
      slot: slotInfo(event),
      patient,
      pipelineId: pipeline.id,
      approvalToken: pipeline.approval_token,
      approvalWindowMinutes: config.approval_window_minutes,
      price: pipeline.procedure_price,
      slackEnabled: config.slack_enabled,
      slackMessageTs: pipeline.slack_message_ts,
      reminder: opts.reminder,
    });
    via = result.via;
    slackMessageTs = result.slackMessageTs;
  } catch (error) {
    console.error("Reception notification failed:", error instanceof Error ? error.message : error);
  }

  if (opts.reminder) {
    await logHistory(deps.db, pipeline, via ? "Reminder sent to reception." : "Reminder could not be emailed to reception.", "engine");
    return;
  }

  await deps.db
    .from("recovery_pipeline")
    .update({ front_desk_notified_via: via ?? "crm", ...(slackMessageTs ? { slack_message_ts: slackMessageTs } : {}) })
    .eq("id", pipeline.id);
  await logHistory(
    deps.db,
    pipeline,
    via ? `Reception notified by ${via}.` : "Reception could not be emailed. The card is waiting in the CRM.",
    "engine",
  );
}

export type ApproveResult = { status: "approved"; late: boolean } | { status: "already_confirmed" };

/** Shared by the CRM button, the /approve page and Slack. */
export async function approveBooking(deps: EngineDeps, pipelineId: string, actor: ApprovalActor): Promise<ApproveResult> {
  const now = nowOf(deps);
  const loaded = await loadPipeline(deps.db, pipelineId);
  if (!loaded) throw new ApiError(404, "not_found", "That card no longer exists.");
  const { pipeline, event, clinic, config } = loaded;

  if (pipeline.stage === "slot_recovered") return { status: "already_confirmed" };
  if (pipeline.stage !== "waiting_staff_approval") {
    throw new ApiError(409, "not_awaiting_approval", "This card is not waiting for approval.");
  }

  const late = Boolean(pipeline.approval_token_expires_at && new Date(pipeline.approval_token_expires_at).getTime() < now.getTime());
  const by = actor.kind === "slack" ? `Approved in Slack by ${actor.label}` : `Approved by ${actor.label}`;

  await transitionStage(deps.db, {
    pipeline: { id: pipeline.id, stage: pipeline.stage },
    to: "slot_recovered",
    triggeredBy: "front_desk",
    note: late ? `${by}. Approval was late: check the slot is still free.` : `${by}.`,
    fields: {
      approved_at: now.toISOString(),
      approved_by: actor.kind === "user" ? actor.userId : null,
      revenue_saved: pipeline.procedure_price ?? 0,
    },
    now,
  });

  // The patient's offer is accepted; every other pending offer for this slot is withdrawn.
  if (pipeline.waitlist_patient_id) {
    const { data: updated } = await deps.db
      .from("waitlist_offers")
      .update({ response: "accepted" })
      .eq("pipeline_id", pipeline.id)
      .eq("waitlist_patient_id", pipeline.waitlist_patient_id)
      .select("id");
    if (!updated || updated.length === 0) {
      await deps.db.from("waitlist_offers").insert({
        pipeline_id: pipeline.id,
        waitlist_patient_id: pipeline.waitlist_patient_id,
        response: "accepted",
        responded_at: now.toISOString(),
        responded_via: "crm",
        offer_token: uuidOf(deps),
      });
    }
  }
  await deps.db.from("waitlist_offers").update({ response: "expired" }).eq("pipeline_id", pipeline.id).eq("response", "pending");

  // Confirmation emails never block the approval. From Slack they run after the 200 reply.
  const sendConfirmations = async () => {
    const patient = await loadPatient(deps, pipeline.waitlist_patient_id);
    if (!patient) return;
    const doctor = readDoctors(config.doctors).find((d) => d.id === event.doctor_id);
    try {
      const summary = await deps.notifier.confirmation({
        clinic: clinicInfo(clinic),
        slot: slotInfo(event),
        patient,
        doctorEmail: doctor?.email ?? null,
        cancelledPatientName: event.cancelled_patient_name,
        pipelineId: pipeline.id,
        price: pipeline.procedure_price,
        shadowMode: config.shadow_mode,
      });
      await logHistory(deps.db, { id: pipeline.id, stage: "slot_recovered" }, summary, "engine");
    } catch (error) {
      console.error("Confirmation emails failed:", error instanceof Error ? error.message : error);
      await logHistory(deps.db, { id: pipeline.id, stage: "slot_recovered" }, "Confirmation emails could not be sent.", "engine");
    }
  };
  if (deps.defer) deps.defer(sendConfirmations);
  else await sendConfirmations();
  await resolveSlack(deps, loaded, "approved", `✅ Approved by ${actor.label}`);
  return { status: "approved", late };
}

/** Close the Slack buttons after any approval path. Never throws. */
async function resolveSlack(deps: EngineDeps, loaded: Loaded, kind: "approved" | "next", text: string): Promise<void> {
  if (!deps.notifier.approvalResolved || !loaded.pipeline.slack_message_ts) return;
  try {
    await deps.notifier.approvalResolved({
      clinic: clinicInfo(loaded.clinic),
      slackMessageTs: loaded.pipeline.slack_message_ts,
      text,
      kind,
    });
  } catch (error) {
    console.error("Slack update failed:", error instanceof Error ? error.message : error);
  }
}

/** Reception declines the YES (patient not suitable): withdraw it and offer the next patient. */
export async function offerToNext(deps: EngineDeps, pipelineId: string, actor: ApprovalActor): Promise<OfferRun> {
  const loaded = await loadPipeline(deps.db, pipelineId);
  if (!loaded) throw new ApiError(404, "not_found", "That card no longer exists.");
  const { pipeline } = loaded;
  if (pipeline.stage !== "waiting_staff_approval") {
    throw new ApiError(409, "not_awaiting_approval", "This card is not waiting for approval.");
  }

  if (pipeline.waitlist_patient_id) {
    await deps.db
      .from("waitlist_offers")
      .update({ response: "declined", responded_at: nowOf(deps).toISOString(), responded_via: "crm" })
      .eq("pipeline_id", pipeline.id)
      .eq("waitlist_patient_id", pipeline.waitlist_patient_id);
  }
  const name = (await loadPatient(deps, pipeline.waitlist_patient_id))?.name;
  await logHistory(
    deps.db,
    pipeline,
    `${name ? shortName(name) : "The patient"} declined by reception (${actor.kind === "slack" ? `Slack, ${actor.label}` : actor.label}).`,
    "front_desk",
  );
  await resolveSlack(deps, loaded, "next", `↪ Offered to the next patient by ${actor.label}`);
  return offerNext(deps, pipelineId, "front_desk");
}

/** Reception has booked the patient in Dentally. Only for a recovered card. */
export async function markBooked(deps: EngineDeps, pipelineId: string, label: string): Promise<boolean> {
  const { data } = await deps.db
    .from("recovery_pipeline")
    .update({ booked_in_pms_at: nowOf(deps).toISOString() })
    .eq("id", pipelineId)
    .eq("stage", "slot_recovered")
    .is("booked_in_pms_at", null)
    .select("id");
  if (!data || data.length === 0) return false;
  await logHistory(deps.db, { id: pipelineId, stage: "slot_recovered" }, `Marked as booked in Dentally by ${label}.`, "front_desk");
  return true;
}

