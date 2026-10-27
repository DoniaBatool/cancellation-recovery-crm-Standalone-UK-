// Reading a patient's SMS reply. Source: SYSTEM_BUILD_GUIDE.md §7 E5.
// Normalise: trim, uppercase, strip punctuation. Then match against the known words.

export type SmsReply = "stop" | "start" | "yes" | "no" | "other";

const STOP = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const START = new Set(["START", "UNSTOP", "YES START"]);
const YES = new Set(["YES", "Y", "YEAH", "YEP", "YUP", "OK", "OKAY", "👍"]);
const NO = new Set(["NO", "N", "NOPE", "NAH"]);

export function normaliseReply(body: string): string {
  // Keep letters, digits, spaces and the thumbs-up so "Yes!" and " yes. " both become "YES".
  return body
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s👍]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function parseSmsReply(body: string): SmsReply {
  const text = normaliseReply(body);
  if (STOP.has(text)) return "stop";
  if (START.has(text)) return "start";
  if (YES.has(text)) return "yes";
  if (NO.has(text)) return "no";
  return "other";
}
