import { describe, expect, it } from "vitest";
import { signDentallyBody, verifyDentallySignature } from "@/lib/dentally/signature";

const SECRET = "a-long-random-webhook-secret";
const BODY = '{"event":"appointment.updated","appointment":{"id":1}}';

describe("Dentally webhook signature", () => {
  it("signs as lowercase hex HMAC-SHA256 (known vector)", () => {
    // HMAC-SHA256("key", "The quick brown fox jumps over the lazy dog")
    expect(signDentallyBody("The quick brown fox jumps over the lazy dog", "key")).toBe("f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8");
  });
  it("accepts the matching header, ignoring case and spaces", () => {
    const sig = signDentallyBody(BODY, SECRET);
    expect(verifyDentallySignature(BODY, SECRET, sig)).toBe(true);
    expect(verifyDentallySignature(BODY, SECRET, ` ${sig.toUpperCase()} `)).toBe(true);
  });
  it("rejects a missing header, a wrong key and a changed body", () => {
    const sig = signDentallyBody(BODY, SECRET);
    expect(verifyDentallySignature(BODY, SECRET, null)).toBe(false);
    expect(verifyDentallySignature(BODY, "other-secret-other-secret", sig)).toBe(false);
    expect(verifyDentallySignature(BODY + " ", SECRET, sig)).toBe(false);
    expect(verifyDentallySignature(BODY, SECRET, "")).toBe(false);
  });
});
