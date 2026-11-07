import type { Db } from "@/lib/pipeline";
import { normalizeUkPhone } from "@/lib/validation";

// STOP suppression by PHONE NUMBER, not by row. A patient who texted STOP is recorded in
// waitlist.sms_opt_out, but the same number can sit on another row (re-added by staff, a family
// member, a second sign-up). Every SMS decision therefore looks at ALL rows of the clinic with
// that number. Only the patient clears it: reply START (inbound-sms.ts updates every row with the
// number) or answer "yes" after signing up again (answerSmsPreference). There is no staff button.

export type OptOutRow = { phone: string | null; sms_opt_out: boolean; sms_opt_out_at?: string | null };

/** Same number in the same shape (E.164), so "07700 900001" and "+447700900001" match. */
export const phoneKey = (phone: string | null | undefined): string | null => normalizeUkPhone(phone);

/** First opted-out row among `rows` that has the same number as `phone`, or null. */
export function findOptOut<T extends OptOutRow>(rows: readonly T[], phone: string | null | undefined): T | null {
  const key = phoneKey(phone);
  if (!key) return null;
  return rows.find((row) => row.sms_opt_out && phoneKey(row.phone) === key) ?? null;
}

/**
 * What a row with `phone` must carry so it matches the earlier STOP: `sms_opt_out = true` and the
 * original `sms_opt_out_at`. Null when the number never opted out.
 */
export function inheritedOptOut<T extends OptOutRow>(
  rows: readonly T[],
  phone: string | null | undefined,
): { sms_opt_out: true; sms_opt_out_at: string | null } | null {
  const match = findOptOut(rows, phone);
  return match ? { sms_opt_out: true, sms_opt_out_at: match.sms_opt_out_at ?? null } : null;
}

/**
 * Normalised numbers that opted out in this clinic (any row, active or not).
 * Returns null when the lookup fails: callers must then NOT send SMS (fail closed).
 */
export async function loadOptedOutPhones(db: Db, clinicId: string): Promise<Set<string> | null> {
  const { data, error } = await db.from("waitlist").select("phone").eq("clinic_id", clinicId).eq("sms_opt_out", true);
  if (error) return null;
  const set = new Set<string>();
  for (const row of data ?? []) {
    const key = phoneKey(row.phone);
    if (key) set.add(key);
  }
  return set;
}

export const STAFF_OPTED_OUT_NOTE = "This patient opted out earlier. They will not get SMS until they reply START.";
