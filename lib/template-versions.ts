// Labels of the patient-facing offer wording. Stored on waitlist_offers.template_version so every
// message can be tied back to the exact text that was sent (DPA clause 5.6).
// Bump the number here whenever the wording in lib/email-templates.ts or lib/sms-templates.ts changes.

export const OFFER_EMAIL_VERSION = "offer-email-v1";
export const OFFER_SMS_VERSION = "offer-sms-v1";

/** Label for the channels an offer actually went out on, e.g. "offer-email-v1,offer-sms-v1". */
export function templateVersionFor(channels: readonly ("sms" | "email")[]): string | null {
  const labels: string[] = [];
  if (channels.includes("email")) labels.push(OFFER_EMAIL_VERSION);
  if (channels.includes("sms")) labels.push(OFFER_SMS_VERSION);
  return labels.length ? labels.join(",") : null;
}
