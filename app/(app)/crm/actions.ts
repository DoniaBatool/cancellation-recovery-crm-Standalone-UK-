"use server";

import { revalidatePath } from "next/cache";
import { ingestCancellation, windowNote } from "@/lib/engine/intake";
import { isStage } from "@/lib/constants";
import type { FormState } from "@/lib/form-state";
import { readDoctors } from "@/lib/doctors";
import { transitionStage } from "@/lib/pipeline";
import { getStaffContext, SIGN_IN_AGAIN } from "@/lib/staff-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { localToUtc } from "@/lib/time";
import { fieldErrors, formDataToObject, manualCancellationSchema, pipelineTargetSchema } from "@/lib/validation";
import { ApiError } from "@/lib/api/http";
import { approveBooking, markBooked, offerToNext, type ApprovalActor } from "@/lib/engine/approve";
import { startOffers } from "@/lib/engine/offer";
import { getEngineDeps } from "@/lib/engine/runtime";

// Pipeline board actions. Source: SYSTEM_BUILD_GUIDE.md §8.3 and §7 E2.
// recovery_pipeline, history and cancellation_events are select-only for the session client,
// so writes go through the admin client AFTER the session check, scoped to the session's clinic.

const SERVER_KEY_MISSING: FormState = { error: "This needs the server key (SUPABASE_SECRET_KEY) to be set." };

function adminOrNull() {
  try {
    return getAdminClient();
  } catch {
    return null;
  }
}

export async function addManualCancellation(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await getStaffContext();
  if (!ctx) return SIGN_IN_AGAIN;

  const parsed = manualCancellationSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;

  const slot = localToUtc(v.slot_date, v.slot_time, ctx.clinic.timezone);
  if (!slot) return { fieldErrors: { slot_date: "Choose a valid date and time." } };

  const { data: config } = await ctx.supabase.from("clinic_config").select("*").eq("clinic_id", ctx.clinic.id).maybeSingle();
  if (!config) return { error: "This clinic has no settings yet. Please contact support." };

  let doctorId: string | null = null;
  let doctorName: string | null = null;
  if (v.doctor_id) {
    const doctor = readDoctors(config.doctors).find((d) => d.id === v.doctor_id);
    if (!doctor) return { fieldErrors: { doctor_id: "Choose a dentist from the list." } };
    doctorId = doctor.id;
    doctorName = doctor.name;
  }

  const admin = adminOrNull();
  if (!admin) return SERVER_KEY_MISSING;

  try {
    const result = await ingestCancellation(admin, {
      clinicId: ctx.clinic.id,
      clinicTimezone: ctx.clinic.timezone,
      config,
      slotDatetime: slot,
      slotDurationMinutes: v.slot_duration_minutes,
      procedureType: v.procedure_type ?? null,
      doctorId,
      doctorName,
      cancelledPatientName: v.cancelled_patient_name ?? null,
      cancellationReason: v.cancellation_reason ?? null,
      pmsSource: "manual",
      triggeredBy: "manual",
      logNote: `Cancellation added manually by ${ctx.actorLabel}`,
    });
    // Offers start straight away when the engine is on and the slot is inside the offer window.
    // A failure here must not hide the new card, so it is logged and reception can press "Start offers".
    if (result.shouldStartOffers && !result.duplicate) {
      const deps = getEngineDeps();
      if (deps) {
        try {
          await startOffers(deps, result.pipelineId);
        } catch (error) {
          console.error("startOffers failed:", error instanceof Error ? error.message : error);
        }
      }
    }
    revalidatePath("/crm");
    const skipped = windowNote(result.windowStatus, config.min_lead_minutes, config.max_horizon_hours);
    return { message: skipped ? `Cancellation added. ${skipped}` : "Cancellation added." };
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    return { error: "Could not add the cancellation. Please try again." };
  }
}

/** Close a card by hand (no patient found, or the slot was filled another way). */
export async function markExpired(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await getStaffContext();
  if (!ctx) return SIGN_IN_AGAIN;

  const parsed = pipelineTargetSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { error: "Something went wrong. Please refresh and try again." };

  // The session client's RLS confirms this card belongs to the user's clinic.
  const { data: card } = await ctx.supabase
    .from("recovery_pipeline")
    .select("id, stage, clinic_id")
    .eq("id", parsed.data.pipeline_id)
    .eq("clinic_id", ctx.clinic.id)
    .maybeSingle();
  if (!card || !isStage(card.stage)) return { error: "That card no longer exists." };

  const admin = adminOrNull();
  if (!admin) return SERVER_KEY_MISSING;

  const reason = parsed.data.reason ?? null;
  try {
    await transitionStage(admin, {
      pipeline: { id: card.id, stage: card.stage },
      to: "expired_manual",
      triggeredBy: "front_desk",
      note: reason ? `Closed by ${ctx.actorLabel}: ${reason}` : `Closed by ${ctx.actorLabel}.`,
      fields: { notes: reason },
    });
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    return { error: "Could not close the card. Please try again." };
  }

  revalidatePath("/crm");
  return { message: "Card closed." };
}

// ---- Card buttons (Phase 3b) ------------------------------------------------------------------
// Each one: session check, the card must belong to the user's clinic (RLS client), then the engine
// runs with the admin client. Any role may use them: reception are "staff".

async function withCard(
  formData: FormData,
  run: (ctx: NonNullable<Awaited<ReturnType<typeof getStaffContext>>>, pipelineId: string, actor: ApprovalActor) => Promise<FormState>,
): Promise<FormState> {
  const ctx = await getStaffContext();
  if (!ctx) return SIGN_IN_AGAIN;

  const parsed = pipelineTargetSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { error: "Something went wrong. Please refresh and try again." };

  const { data: card } = await ctx.supabase
    .from("recovery_pipeline")
    .select("id")
    .eq("id", parsed.data.pipeline_id)
    .eq("clinic_id", ctx.clinic.id)
    .maybeSingle();
  if (!card) return { error: "That card no longer exists." };

  try {
    const result = await run(ctx, card.id, { kind: "user", userId: ctx.user.id, label: ctx.actorLabel });
    revalidatePath("/crm");
    return result;
  } catch (error) {
    if (error instanceof ApiError) return { error: error.message };
    console.error("Card action failed:", error instanceof Error ? error.message : error);
    return { error: "Something went wrong. Please try again." };
  }
}

export async function approvePipeline(_prev: FormState, formData: FormData): Promise<FormState> {
  return withCard(formData, async (_ctx, pipelineId, actor) => {
    const deps = getEngineDeps();
    if (!deps) return SERVER_KEY_MISSING;
    const result = await approveBooking(deps, pipelineId, actor);
    if (result.status === "already_confirmed") return { message: "Already approved." };
    return { message: result.late ? "Approved. The approval was late, so check the slot is still free." : "Approved." };
  });
}

export async function offerNextPatient(_prev: FormState, formData: FormData): Promise<FormState> {
  return withCard(formData, async (_ctx, pipelineId, actor) => {
    const deps = getEngineDeps();
    if (!deps) return SERVER_KEY_MISSING;
    const run = await offerToNext(deps, pipelineId, actor);
    if (run.status === "offered") return { message: "Offered to the next patient." };
    if (run.status === "gave_up") return { message: `No more patients to offer: ${run.reason}. The card is closed.` };
    if (run.status === "deferred") return { message: "The next offer is held until quiet hours end." };
    return { error: run.reason };
  });
}

export async function markPipelineBooked(_prev: FormState, formData: FormData): Promise<FormState> {
  return withCard(formData, async (_ctx, pipelineId, actor) => {
    const deps = getEngineDeps();
    if (!deps) return SERVER_KEY_MISSING;
    const done = await markBooked(deps, pipelineId, actor.label);
    return done ? { message: "Marked as booked." } : { error: "This card can't be marked as booked." };
  });
}

export async function startOffersNow(_prev: FormState, formData: FormData): Promise<FormState> {
  return withCard(formData, async (ctx, pipelineId) => {
    const { data: config } = await ctx.supabase.from("clinic_config").select("engine_enabled").eq("clinic_id", ctx.clinic.id).maybeSingle();
    if (!config?.engine_enabled) return { error: "Switch the offer engine on in Settings first." };
    const deps = getEngineDeps();
    if (!deps) return SERVER_KEY_MISSING;
    const run = await startOffers(deps, pipelineId, "front_desk");
    if (run.status === "offered") return { message: "Offer sent." };
    if (run.status === "gave_up") return { message: `Nobody to offer: ${run.reason}. The card is closed.` };
    if (run.status === "deferred") return { message: "Offers are held until quiet hours end." };
    return { error: run.reason };
  });
}
