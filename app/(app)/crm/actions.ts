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
    // Phase 3 starts the offers here when result.shouldStartOffers is true.
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
