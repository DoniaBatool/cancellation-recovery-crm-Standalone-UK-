import { ApiError } from "@/lib/api/http";
import type { Actor, Stage } from "@/lib/constants";
import type { Json } from "@/lib/database.types";
import { getProcedurePrice, procedureLabel, type PriceConfig } from "@/lib/pricing";
import { type Db } from "@/lib/pipeline";
import { formatSlot } from "@/lib/format";

// Cancellation intake. Source: SYSTEM_BUILD_GUIDE.md §7 E2 (ingestCancellation).
// Phase 2 uses it for manual entry; Phase 5 adds the Dentally webhook and poller on top.
//
//   1. If pms_appointment_id already exists, return the existing pipeline (duplicate: true).
//   2. A slot in the past, sooner than min_lead_minutes or beyond max_horizon_hours is still
//      logged, with a note, so reception sees it. It is not offered to anyone.
//   3. Insert the cancellation_events row. If inserting the pipeline fails, delete the event
//      (keep the pair atomic).
//   4. Insert the recovery_pipeline row (stage cancellation_detected, detected_at, procedure_price).
//   5. Log history.
//   6. The caller starts offers (Phase 3) when `shouldStartOffers` is true.

export type SlotWindow = "ok" | "past" | "too_soon" | "too_far";

/** Pure: is this slot worth offering? */
export function slotWindowStatus(
  slot: Date,
  now: Date,
  minLeadMinutes: number,
  maxHorizonHours: number,
): SlotWindow {
  const ms = slot.getTime() - now.getTime();
  if (ms <= 0) return "past";
  if (ms < minLeadMinutes * 60_000) return "too_soon";
  if (ms > maxHorizonHours * 3_600_000) return "too_far";
  return "ok";
}

export function windowNote(status: SlotWindow, minLeadMinutes: number, maxHorizonHours: number): string | null {
  switch (status) {
    case "ok":
      return null;
    case "past":
      return "Not offered: the slot is in the past.";
    case "too_soon":
      return `Not offered: the slot starts in less than ${minLeadMinutes} minutes.`;
    case "too_far":
      return `Not offered: the slot is more than ${maxHorizonHours} hours away.`;
  }
}

export type IntakeConfig = PriceConfig & {
  min_lead_minutes: number;
  max_horizon_hours: number;
  engine_enabled: boolean;
};

export type IntakeInput = {
  clinicId: string;
  clinicTimezone: string;
  config: IntakeConfig;
  slotDatetime: Date;
  slotDurationMinutes: number;
  procedureType: string | null;
  doctorId: string | null;
  doctorName: string | null;
  cancelledPatientName?: string | null;
  cancelledPatientEmail?: string | null;
  cancelledPatientPhone?: string | null;
  cancellationReason?: string | null;
  pmsSource: "dentally" | "manual";
  pmsAppointmentId?: string | null;
  rawPayload?: Json | null;
  /** Who is recorded in the history row. */
  triggeredBy: Actor;
  /** First history note, e.g. "Cancellation added manually by reception@clinic.co.uk". */
  logNote: string;
  now?: Date;
};

export type IntakeResult = {
  duplicate: boolean;
  eventId: string;
  pipelineId: string;
  stage: Stage;
  windowStatus: SlotWindow;
  /** True when the engine is on and the slot is inside the offer window (Phase 3 starts offers). */
  shouldStartOffers: boolean;
};

export async function ingestCancellation(db: Db, input: IntakeInput): Promise<IntakeResult> {
  const now = input.now ?? new Date();
  const { config } = input;

  // 1. Idempotency: the same PMS appointment never creates a second card.
  if (input.pmsAppointmentId) {
    const { data: existingEvent } = await db
      .from("cancellation_events")
      .select("id")
      .eq("clinic_id", input.clinicId)
      .eq("pms_source", input.pmsSource)
      .eq("pms_appointment_id", input.pmsAppointmentId)
      .maybeSingle();
    if (existingEvent) {
      const { data: existingPipeline } = await db
        .from("recovery_pipeline")
        .select("id, stage")
        .eq("cancellation_event_id", existingEvent.id)
        .maybeSingle();
      if (existingPipeline) {
        return {
          duplicate: true,
          eventId: existingEvent.id,
          pipelineId: existingPipeline.id,
          stage: existingPipeline.stage as Stage,
          windowStatus: "ok",
          shouldStartOffers: false,
        };
      }
    }
  }

  // 2. Window check (note only).
  const windowStatus = slotWindowStatus(input.slotDatetime, now, config.min_lead_minutes, config.max_horizon_hours);

  // 3. Event row.
  const { data: event, error: eventError } = await db
    .from("cancellation_events")
    .insert({
      clinic_id: input.clinicId,
      slot_datetime: input.slotDatetime.toISOString(),
      slot_duration_minutes: input.slotDurationMinutes,
      procedure_type: input.procedureType,
      doctor_id: input.doctorId,
      doctor_name: input.doctorName,
      cancelled_patient_name: input.cancelledPatientName ?? null,
      cancelled_patient_email: input.cancelledPatientEmail ?? null,
      cancelled_patient_phone: input.cancelledPatientPhone ?? null,
      cancellation_reason: input.cancellationReason ?? null,
      detected_at: now.toISOString(),
      pms_source: input.pmsSource,
      pms_appointment_id: input.pmsAppointmentId ?? null,
      raw_payload: input.rawPayload ?? null,
    })
    .select("id")
    .single();
  if (eventError || !event) {
    throw new ApiError(500, "event_insert_failed", "Could not save the cancellation.");
  }

  // 4. Pipeline row. Roll the event back if this fails so the pair stays together.
  const { data: pipeline, error: pipelineError } = await db
    .from("recovery_pipeline")
    .insert({
      clinic_id: input.clinicId,
      cancellation_event_id: event.id,
      stage: "cancellation_detected",
      detected_at: now.toISOString(),
      procedure_price: getProcedurePrice(config, input.procedureType),
    })
    .select("id")
    .single();
  if (pipelineError || !pipeline) {
    await db.from("cancellation_events").delete().eq("id", event.id);
    throw new ApiError(500, "pipeline_insert_failed", "Could not save the cancellation.");
  }

  // 5. History. A missing row must not hide the card, so log and carry on.
  const slotText = `${procedureLabel(input.procedureType)} on ${formatSlot(input.slotDatetime, input.clinicTimezone)}`;
  const notes = [`${input.logNote} (${slotText}).`];
  const extra = windowNote(windowStatus, config.min_lead_minutes, config.max_horizon_hours);
  if (extra) notes.push(extra);
  for (const [i, note] of notes.entries()) {
    const { error } = await db.from("recovery_pipeline_history").insert({
      pipeline_id: pipeline.id,
      from_stage: i === 0 ? null : "cancellation_detected",
      to_stage: "cancellation_detected",
      note,
      triggered_by: input.triggeredBy,
    });
    if (error) console.error("Could not write pipeline history:", error.message);
  }

  return {
    duplicate: false,
    eventId: event.id,
    pipelineId: pipeline.id,
    stage: "cancellation_detected",
    windowStatus,
    shouldStartOffers: config.engine_enabled && windowStatus === "ok",
  };
}
