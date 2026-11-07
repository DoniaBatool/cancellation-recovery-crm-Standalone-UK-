"use server";

import { z } from "zod";
import type { FormState } from "@/lib/form-state";
import { RATE_LIMITS } from "@/lib/rate-limit";
import { isIpRateLimited } from "@/lib/rate-limit-request";
import { getAdminClient } from "@/lib/supabase/admin";
import { inheritedOptOut, phoneKey } from "@/lib/sms-suppression";
import { JOIN_ADDED_BY, joinSourceFrom, planOptIn } from "@/lib/waitlist-optin";
import { fieldErrors, formDataToObject, publicJoinSchema } from "@/lib/validation";

// Public waitlist sign-up. Source: SYSTEM_BUILD_GUIDE.md §6.5, §8.1 and §9.9.
// No login, so this uses the admin client. It only ever touches the clinic found by the
// slug, and only inserts or updates that clinic's own waitlist rows.

export async function joinClinicWaitlist(slug: string, src: string | undefined, _prev: FormState, formData: FormData): Promise<FormState> {
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
    admin.from("waitlist").select("id, email, phone, sms_opt_out, sms_opt_out_at, scrubbed_at").eq("clinic_id", clinic.id).eq("phone", v.phone),
    admin.from("waitlist").select("id, email, phone, sms_opt_out, sms_opt_out_at, scrubbed_at").eq("clinic_id", clinic.id).eq("email", v.email),
  ]);
  if (byPhone.error || byEmail.error) return { error: "Sorry, something went wrong. Please try again." };
  const found = [...(byPhone.data ?? []), ...(byEmail.data ?? [])];
  // A row the 30-day scrub emptied is never reused: the person gets a fresh row. It still counts for STOP.
  const existing = found.filter((row) => !row.scrubbed_at);

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
  if (plan.action === "update") {
    const { error } = await admin.from("waitlist").update(fields).eq("id", plan.id).eq("clinic_id", clinic.id);
    if (error) return { error: "Sorry, something went wrong. Please try again." };
    // This patient earlier replied STOP to a text. Ask what they want now (answerSmsPreference).
    const matched = existing.find((row) => row.id === plan.id);
    if (matched?.sms_opt_out) return { message: "joined", askSmsPreference: { patientId: plan.id } };
    return { message: "joined" };
  }

  // New row. If this number opted out earlier (even on a row that was since scrubbed), the new row inherits it.
  const inherited = inheritedOptOut(found, v.phone);
  const { data: created, error } = await admin
    .from("waitlist")
    .insert({ ...fields, ...(inherited ?? {}), clinic_id: clinic.id, opt_in_source: joinSourceFrom(src), added_by: JOIN_ADDED_BY })
    .select("id")
    .single();
  if (error) return { error: "Sorry, something went wrong. Please try again." };
  if (inherited && created?.id) return { message: "joined", askSmsPreference: { patientId: created.id } };

  return { message: "joined" };
}

/**
 * After sign-up, a patient who earlier texted STOP is asked "do you want text offers again?".
 * "yes" clears our opt-out flag; "no" changes nothing (email only). Public, so it is rate limited
 * and only touches an opted-out row of the clinic named by the slug.
 */
export async function answerSmsPreference(slug: string, patientId: string, answer: string): Promise<{ ok: boolean; message: string }> {
  const fail = { ok: false, message: "Sorry, something went wrong. Please try again." };
  if (answer !== "yes" && answer !== "no") return fail;
  if (!z.uuid().safeParse(patientId).success) return fail;

  if (await isIpRateLimited(RATE_LIMITS.smsPreference)) {
    return { ok: false, message: "Too many attempts. Please try again later, or ask the practice." };
  }

  let admin: ReturnType<typeof getAdminClient>;
  try {
    admin = getAdminClient();
  } catch {
    return fail;
  }

  const { data: clinic } = await admin.from("clinics").select("id").eq("slug", slug).eq("is_active", true).maybeSingle();
  if (!clinic) return fail;

  const { data: row } = await admin
    .from("waitlist")
    .select("id, phone, sms_opt_out")
    .eq("id", patientId)
    .eq("clinic_id", clinic.id)
    .maybeSingle();
  if (!row || !row.sms_opt_out) return fail;

  if (answer === "no") return { ok: true, message: "No problem. We'll only email you." };

  // STOP follows the number, so "yes" clears it on every opted-out row of this clinic with the same number
  // (for example an older row that the 30-day scrub emptied). Otherwise that row would keep blocking texts.
  const { data: optedOut, error: lookupError } = await admin.from("waitlist").select("id, phone").eq("clinic_id", clinic.id).eq("sms_opt_out", true);
  if (lookupError) return fail;
  const key = phoneKey(row.phone);
  const ids = new Set([row.id, ...(optedOut ?? []).filter((r) => key !== null && phoneKey(r.phone) === key).map((r) => r.id)]);
  const { error } = await admin
    .from("waitlist")
    .update({ sms_opt_out: false, sms_opt_out_at: null })
    .in("id", [...ids])
    .eq("clinic_id", clinic.id);
  if (error) return fail;
  return { ok: true, message: "Thanks. We'll text you again. If texts don't arrive, reply START to the last message you received from us." };
}
