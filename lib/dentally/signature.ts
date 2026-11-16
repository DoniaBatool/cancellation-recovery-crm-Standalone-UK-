import { createHmac } from "node:crypto";
import { safeEqual } from "@/lib/api/auth";

// Dentally signs each webhook: HMAC-SHA256 of the raw request body, keyed with the webhook's secret,
// sent as lowercase hex (no prefix, no timestamp) in the X-Dentally-Signature header.
// Source: Hookdeck's Dentally webhook guide and Dentally's own help text; still to be confirmed against a real delivery.

export const DENTALLY_SIGNATURE_HEADER = "x-dentally-signature";

export function signDentallyBody(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

/** True only when the header is present and matches the body (constant-time compare). */
export function verifyDentallySignature(rawBody: string, secret: string, header: string | null): boolean {
  if (!header) return false;
  return safeEqual(signDentallyBody(rawBody, secret), header.trim().toLowerCase());
}
