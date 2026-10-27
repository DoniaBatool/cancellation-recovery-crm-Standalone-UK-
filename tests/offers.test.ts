import { describe, expect, it } from "vitest";
import { getOfferState, isValidToken } from "@/lib/offers";

const NOW = new Date("2026-10-26T10:00:00Z");
const future = "2026-10-26T10:30:00Z";
const past = "2026-10-26T09:30:00Z";

describe("getOfferState", () => {
  it("accepted and declined win over everything else", () => {
    expect(getOfferState({ response: "accepted", offer_expires_at: past }, { stage: "slot_recovered" }, NOW)).toBe("accepted");
    expect(getOfferState({ response: "declined", offer_expires_at: past }, { stage: "expired_manual" }, NOW)).toBe("declined");
  });

  it("a recovered or closed slot is unavailable, even for a pending offer", () => {
    expect(getOfferState({ response: "pending", offer_expires_at: future }, { stage: "slot_recovered" }, NOW)).toBe("slot_unavailable");
    expect(getOfferState({ response: "pending", offer_expires_at: future }, { stage: "expired_manual" }, NOW)).toBe("slot_unavailable");
    expect(getOfferState({ response: "expired", offer_expires_at: past }, { stage: "slot_recovered" }, NOW)).toBe("slot_unavailable");
  });

  it("expired by response or by time", () => {
    expect(getOfferState({ response: "expired", offer_expires_at: future }, { stage: "offer_sent" }, NOW)).toBe("expired");
    expect(getOfferState({ response: "pending", offer_expires_at: past }, { stage: "offer_sent" }, NOW)).toBe("expired");
  });

  it("open while pending and before expiry (or with no expiry)", () => {
    expect(getOfferState({ response: "pending", offer_expires_at: future }, { stage: "offer_sent" }, NOW)).toBe("open");
    expect(getOfferState({ response: "pending", offer_expires_at: null }, { stage: "offer_sent" }, NOW)).toBe("open");
    expect(getOfferState({ response: "pending", offer_expires_at: NOW.toISOString() }, { stage: "offer_sent" }, NOW)).toBe("open");
  });
});

describe("isValidToken", () => {
  it("accepts UUIDs and rejects anything else", () => {
    expect(isValidToken("3f2b8c1e-5d4a-4b6c-9e7f-1a2b3c4d5e6f")).toBe(true);
    expect(isValidToken("not-a-token")).toBe(false);
    expect(isValidToken("")).toBe(false);
    expect(isValidToken(undefined)).toBe(false);
    expect(isValidToken("3f2b8c1e-5d4a-4b6c-9e7f-1a2b3c4d5e6f; drop table")).toBe(false);
  });
});
