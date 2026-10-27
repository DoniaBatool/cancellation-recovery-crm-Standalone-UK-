import { formatSlot } from "@/lib/format";

// SMS copy. Source: SYSTEM_BUILD_GUIDE.md §10.2.
// GSM-7 characters only and 160 or fewer where possible (one segment). No emojis, no curly quotes:
// those switch the message to UCS-2 (70 characters per segment) and cost more.

const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\u001bÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXTENDED = "^{}\\[~]|€\f";

export function isGsm7(text: string): boolean {
  for (const ch of text) {
    if (!GSM7_BASIC.includes(ch) && !GSM7_EXTENDED.includes(ch)) return false;
  }
  return true;
}

/** Replace the look-alike characters people paste (curly quotes, dashes) so a message stays GSM-7. */
export function toGsm7(text: string): string {
  return text
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/ /g, " ");
}

/** "Tue 14 Oct 14:30" (no comma, to save a character). */
function slotText(datetime: string, timeZone: string): string {
  return formatSlot(datetime, timeZone).replace(",", "");
}

export type OfferSmsInput = {
  clinicName: string;
  timeZone: string;
  procedure: string | null;
  dentist: string | null;
  slotDatetime: string;
  link: string;
  expiryMinutes: number;
  differentDentist: boolean;
};

export const SMS_LIMIT = 160;

export function offerSms(i: OfferSmsInput): string {
  const procedure = i.procedure ? i.procedure.toLowerCase() : "dental";
  const who = i.dentist ? ` with ${i.dentist}` : "";
  const other = i.differentDentist && i.dentist ? ` (not your usual dentist)` : "";
  const build = (clinic: string) =>
    toGsm7(
      `${clinic}: a ${procedure} slot ${slotText(i.slotDatetime, i.timeZone)}${who}${other} is free. ` +
        `Want it? ${i.link} or reply YES/NO. Held ${i.expiryMinutes} min. STOP to opt out`,
    );

  let clinic = i.clinicName.trim();
  let text = build(clinic);
  // Over one segment: shorten the clinic name (never below 8 characters).
  while (text.length > SMS_LIMIT && clinic.length > 8) {
    clinic = clinic.slice(0, Math.max(8, clinic.length - (text.length - SMS_LIMIT))).trimEnd();
    text = build(clinic);
    if (clinic.length <= 8) break;
  }
  return text;
}

export const yesReceivedSms = (clinicName: string) => toGsm7(`Thanks! ${clinicName} will confirm your booking shortly.`);
export const noReceivedSms = () => "No problem, we'll keep you on the list.";
export const tooLateSms = () => "Sorry, that slot has now gone. We'll text you next time.";
export const bookedSms = (i: { clinicName: string; clinicPhone: string | null; slotDatetime: string; timeZone: string }) =>
  toGsm7(`Confirmed: ${slotText(i.slotDatetime, i.timeZone)} at ${i.clinicName}.${i.clinicPhone ? ` Can't make it? Call ${i.clinicPhone}.` : ""}`);
export const stopSms = (clinicName: string) => toGsm7(`You won't get more texts from ${clinicName}. Reply START to rejoin.`);
export const startSms = (clinicName: string) => toGsm7(`You're back on the list for ${clinicName}. Reply STOP to opt out.`);
export const unknownReplySms = () => "Thanks, the practice will get back to you.";
