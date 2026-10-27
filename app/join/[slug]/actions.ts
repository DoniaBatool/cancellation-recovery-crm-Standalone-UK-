"use server";

import type { FormState } from "@/lib/form-state";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { isIpRateLimited } from "@/lib/rate-limit-request";
import { getAdminClient } from "@/lib/supabase/admin";
import { JOIN_ADDED_BY, JOIN_SOURCE, planOptIn } from "@/lib/waitlist-optin";
import { fieldErrors, formDataToObject, publicJoinSchema } from "@/lib/validation";

// Public waitlist sign-up. Source: SYSTEM_BUILD_GUIDE.md §6.5, §8.1 and §9.9.
// No login, so this uses the admin client. It only ever touches the clinic found by the
// slug, and only inserts or updates that clinic's own waitlist rows.

export async function joinClinicWaitlist(slug: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const raw = formDataToObject(formData);

  // Honeypot: real people never fill this. Pretend it worked so bots learn nothing.
  if (typeof raw.website === "string" && raw.website.trim() !== "") {
    return { message: "joined" };
  }

  if (await isIpRateLimited(RATE_LIMITS.join)) {
    return { error: "Too many sign-ups from this connection. Please try again in a little while, or ask the practice to add you." };
  }

  const parsed = publicJoinSchema.safeParse(raw);
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;

  let admin: ReturnType<typeof getAdminClient>;
  try {
    admin = getAdminClient();
  } catch {
    return { error: "Sorry, we can't take sign-ups right now. Please try again later." };
  }

  const { data: clinic } = await admin
    .from("clinics")
    .select("id")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();
  if (!clinic) return { error: "This sign-up link is not valid." };

  // Two simple lookups (instead of one OR filter) so odd characters can't break the query.
  const [byPhone, byEmail] = await Promise.all([
    admin.from("waitlist").select("id, email, phone").eq("clinic_id", clinic.id).eq("phone", v.phone),
    admin.from("waitlist").select("id, email, phone").eq("clinic_id", clinic.id).eq("email", v.email),
  ]);
  if (byPhone.error || byEmail.error) return { error: "Sorry, something went wrong. Please try again." };
  const existing = [...(byPhone.data ?? []), ...(byEmail.data ?? [])];

  const fields = {
    patient_name: v.patient_name,
    email: v.email,
    phone: v.phone,
    preferred_procedures: v.preferred_procedures,
    preferred_days: v.preferred_days,
    preferred_times: v.preferred_times,
    preferred_doctors: v.preferred_doctors,
    max_notice_hours: v.max_notice_hours,
    existing_patient: v.existing_patient,
    is_active: true,
  };

  const plan = planOptIn(existing, { phone: v.phone, email: v.email });
  const { error } =
    plan.action === "update"
      ? await admin.from("waitlist").update(fields).eq("id", plan.id).eq("clinic_id", clinic.id)
      : await admin.from("waitlist").insert({
          ...fields,
          clinic_id: clinic.id,
          opt_in_source: JOIN_SOURCE,
          added_by: JOIN_ADDED_BY,
        });
  if (error) return { error: "Sorry, something went wrong. Please try again." };

  return { message: "joined" };
}
