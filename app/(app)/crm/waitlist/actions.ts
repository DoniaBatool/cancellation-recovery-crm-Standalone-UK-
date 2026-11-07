"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/lib/form-state";
import { inheritedOptOut, STAFF_OPTED_OUT_NOTE } from "@/lib/sms-suppression";
import { getStaffContext, SIGN_IN_AGAIN } from "@/lib/staff-session";
import { fieldErrors, formDataToObject, waitlistPatientFormSchema } from "@/lib/validation";
import { z } from "zod";

// Waitlist actions. Source: SYSTEM_BUILD_GUIDE.md §8.3. They use the session (RLS) client:
// the database policies already limit every row to the signed-in user's clinic.

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
    const { data, error } = await ctx.supabase
      .from("waitlist")
      .update({ ...fields, ...(inherited ?? {}) })
      .eq("id", id)
      .eq("clinic_id", ctx.clinic.id)
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

  const { error } = await ctx.supabase
    .from("waitlist")
    .update({ is_active: parsed.data.active })
    .eq("id", parsed.data.id)
    .eq("clinic_id", ctx.clinic.id);
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
