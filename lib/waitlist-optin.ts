// Waitlist sign-up dedupe. Source: SYSTEM_BUILD_GUIDE.md §6.5.
//
// On a public /join submit:
//   - a row with the same phone OR email already in this clinic is updated and set active again;
//   - otherwise a new row is inserted (opt_in_source 'sms_link', added_by 'Patient (sign-up link)').

export type OptInCandidate = { id: string; email: string | null; phone: string | null };

export type OptInPlan = { action: "update"; id: string } | { action: "insert" };

export const JOIN_ADDED_BY = "Patient (sign-up link)";
export const JOIN_SOURCE = "sms_link";

const normEmail = (value: string | null | undefined) => (value ? value.trim().toLowerCase() : null);

/**
 * Decide whether a sign-up matches an existing row. `existing` is the clinic's own rows.
 * A phone match wins over an email match when both exist on different rows.
 */
export function planOptIn(
  existing: OptInCandidate[],
  input: { phone: string | null; email: string | null },
): OptInPlan {
  const email = normEmail(input.email);
  const phone = input.phone ? input.phone.trim() : null;

  const byPhone = phone ? existing.find((row) => row.phone && row.phone.trim() === phone) : undefined;
  if (byPhone) return { action: "update", id: byPhone.id };

  const byEmail = email ? existing.find((row) => normEmail(row.email) === email) : undefined;
  if (byEmail) return { action: "update", id: byEmail.id };

  return { action: "insert" };
}
