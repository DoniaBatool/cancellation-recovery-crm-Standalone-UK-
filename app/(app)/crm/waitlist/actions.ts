"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/lib/form-state";
import { inheritedOptOut, SCRUBBED_PATIENT_NOTE, STAFF_OPTED_OUT_NOTE } from "@/lib/sms-suppression";
import { getStaffContext, SIGN_IN_AGAIN } from "@/lib/staff-session";
import { fieldErrors, formDataToObject, waitlistPatientFormSchema } from "@/lib/validation";
import { z } from "zod";

// Waitlist actions. Source: SYSTEM_BUILD_GUIDE.md §8.3. They use the session (RLS) client:
// the database policies already limit every row to the signed-in user's clinic.

type StaffDb = NonNullable<Awaited<ReturnType<typeof getStaffContext>>>["supabase"];

/** True when the 30-day scrub already emptied this row. null = could not check. */
async function isScrubbedRow(db: StaffDb, clinicId: string, id: string): Promise<boolean | null> {
  const { data, error } = await db.from("waitlist").select("scrubbed_at").eq("id", id).eq("clinic_id", clinicId).maybeSingle();
  if (error) return null;
  return Boolean(data?.scrubbed_at);
}

export async function saveWaitlistPatient(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await getStaffContext();
  if (!ctx) return SIGN_IN_AGAIN;

  const parsed = waitlistPatientFormSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const { id, ...v } = parsed.data;

  const fields = {
    patient_name: v.patient_name,
    email: v.email ?? null,
    phone: v.phone ?? null,
    preferred_procedures: v.preferred_procedures,
    preferred_days: v.preferred_days,
    preferred_times: v.preferred_times,
    preferred_doctors: v.preferred_doctors,
    max_notice_hours: v.max_notice_hours,
    existing_patient: v.existing_patient,
    notes: v.notes ?? null,
  };

  // STOP follows the phone number. If another row of this clinic with the same number opted out, this
  // row inherits it (flag + date) and keeps it. Staff can only ever SET it here, never clear it:
  // only the patient clears it (reply START, or "yes" after signing up again).
  let inherited: ReturnType<typeof inheritedOptOut> = null;
  if (fields.phone) {
    const { data: sameClinic, error: lookupError } = await ctx.supabase
      .from("waitlist")
      .select("id, phone, sms_opt_out, sms_opt_out_at")
      .eq("clinic_id", ctx.clinic.id)
      .eq("sms_opt_out", true);
    if (lookupError) return { error: "Could not check the patient's SMS preference. Please try again." };
    inherited = inheritedOptOut((sameClinic ?? []).filter((row) => row.id !== id), fields.phone);
  }

  if (id) {
    // A scrubbed row has no name or email any more and must stay empty: staff add the person as a new row.
    const scrubbed = await isScrubbedRow(ctx.supabase, ctx.clinic.id, id);
    if (scrubbed === null) return { error: "Could not save the patient. Please try again." };
    if (scrubbed) return { error: SCRUBBED_PATIENT_NOTE };
    const { data, error } = await ctx.supabase
      .from("waitlist")
      .update({ ...fields, ...(inherited ?? {}) })
      .eq("id", id)
      .eq("clinic_id", ctx.clinic.id)
      .is("scrubbed_at", null)
      .select("id");
    if (error) return { error: "Could not save the patient. Please try again." };
    if (!data?.length) return { error: "That patient no longer exists." };
  } else {
    const { error } = await ctx.supabase.from("waitlist").insert({
      ...fields,
      ...(inherited ?? {}),
      clinic_id: ctx.clinic.id,
      added_by: ctx.actorLabel,
      opt_in_source: "receptionist",
      is_active: true,
    });
    if (error) return { error: "Could not add the patient. Please try again." };
  }

  revalidatePath("/crm/waitlist");
  const base = id ? "Patient updated." : "Patient added.";
  return inherited ? { message: base, smsOptedOutNote: STAFF_OPTED_OUT_NOTE } : { message: base };
}

const toggleSchema = z.object({ id: z.uuid(), active: z.boolean() });

export async function setWaitlistActive(id: string, active: boolean): Promise<FormState> {
  const ctx = await getStaffContext();
  if (!ctx) return SIGN_IN_AGAIN;
  const parsed = toggleSchema.safeParse({ id, active });
  if (!parsed.success) return { error: "Something went wrong. Please refresh and try again." };

  // Switching ON a row the 30-day scrub already emptied is refused: it has no name or email left.
  if (parsed.data.active) {
    const scrubbed = await isScrubbedRow(ctx.supabase, ctx.clinic.id, parsed.data.id);
    if (scrubbed === null) return { error: "Could not update the patient." };
    if (scrubbed) return { error: SCRUBBED_PATIENT_NOTE };
  }

  let update = ctx.supabase.from("waitlist").update({ is_active: parsed.data.active }).eq("id", parsed.data.id).eq("clinic_id", ctx.clinic.id);
  if (parsed.data.active) update = update.is("scrubbed_at", null); // also guards a scrub that ran a moment ago
  const { error } = await update;
  if (error) return { error: "Could not update the patient." };

  revalidatePath("/crm/waitlist");
  return { message: parsed.data.active ? "Patient is active." : "Patient paused." };
}

/** Permanent delete, for erasure requests (guide §8.3). Offers cascade; recovered pipelines keep revenue. */
export async function removeWaitlistPatient(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await getStaffContext();
  if (!ctx) return SIGN_IN_AGAIN;
  const parsed = z.object({ id: z.uuid() }).safeParse(formDataToObject(formData));
  if (!parsed.success) return { error: "Something went wrong. Please refresh and try again." };

  const { error } = await ctx.supabase
    .from("waitlist")
    .delete()
    .eq("id", parsed.data.id)
    .eq("clinic_id", ctx.clinic.id);
  if (error) return { error: "Could not remove the patient." };

  revalidatePath("/crm/waitlist");
  return { message: "Patient removed." };
}
