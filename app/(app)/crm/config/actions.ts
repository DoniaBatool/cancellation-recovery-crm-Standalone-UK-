"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/lib/form-state";
import { getStaffContext, NOT_ALLOWED, SIGN_IN_AGAIN } from "@/lib/staff-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { clinicConfigSchema, fieldErrors, formDataToObject, normaliseDoctors } from "@/lib/validation";

// Settings. Source: SYSTEM_BUILD_GUIDE.md §8.3 and §9.7. Owner and admin only.
// clinic_config is updated through the session (RLS) client. clinics.contact_email has no
// update policy, so it goes through the admin client AFTER the role check, scoped to the
// session's clinic id.

export async function saveClinicConfig(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await getStaffContext(["owner", "admin"]);
  if (!ctx) return (await getStaffContext()) ? NOT_ALLOWED : SIGN_IN_AGAIN;

  const parsed = clinicConfigSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const { contact_email, doctors, ...config } = parsed.data;

  const { data, error } = await ctx.supabase
    .from("clinic_config")
    .update({ ...config, doctors: normaliseDoctors(doctors) })
    .eq("clinic_id", ctx.clinic.id)
    .select("id");
  if (error) return { error: "Could not save the settings. Please try again." };
  if (!data?.length) return { error: "This clinic has no settings row yet. Please contact support." };

  try {
    const admin = getAdminClient();
    const { error: emailError } = await admin
      .from("clinics")
      .update({ contact_email: contact_email ?? null })
      .eq("id", ctx.clinic.id);
    if (emailError) return { error: "Settings saved, but the reception email could not be updated." };
  } catch {
    return { error: "Settings saved, but the reception email could not be updated (server key missing)." };
  }

  revalidatePath("/crm/config");
  return { message: "Settings saved." };
}
