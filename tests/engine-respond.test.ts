import { describe, expect, it } from "vitest";
import { respondToOffer } from "@/lib/engine/respond";
import { NOW, makeWorld, patientRow } from "./helpers/engine-world";

const TOKEN_A = "11111111-1111-4111-8111-111111111111";
const TOKEN_B = "22222222-2222-4222-8222-222222222222";

function offerRow(id: string, patient: string, token: string, over: Record<string, unknown> = {}) {
  return { id, pipeline_id: "p1", waitlist_patient_id: patient, offer_token: token, response: "pending", offer_expires_at: "2026-10-26T10:30:00Z", ...over };
}

describe("respondToOffer", () => {
  it("rejects a token that is not a UUID or unknown", async () => {
    const w = makeWorld({ pipeline: { stage: "offer_sent" } });
    expect(await respondToOffer(w.deps, "nope", "accepted", "link")).toEqual({ state: "slot_unavailable" });
    expect(await respondToOffer(w.deps, TOKEN_A, "accepted", "link")).toEqual({ state: "slot_unavailable" });
  });

  it("YES: records the answer, moves to waiting_staff_approval with an approval token, expires other offers, notifies reception", async () => {
    const w = makeWorld({
      pipeline: { stage: "offer_sent", waitlist_patient_id: "a" },
      offers: [offerRow("o1", "a", TOKEN_A), offerRow("o2", "b", TOKEN_B)],
    });
    const result = await respondToOffer(w.deps, TOKEN_A, "accepted", "link");

    expect(result).toEqual({ state: "accepted" });
    expect(w.offers().find((o) => o.id === "o1")).toMatchObject({ response: "accepted", responded_via: "link", responded_at: NOW.toISOString() });
    expect(w.offers().find((o) => o.id === "o2")?.response).toBe("expired");
    expect(w.pipeline()).toMatchObject({
      stage: "waiting_staff_approval",
      waitlist_patient_id: "a",
      approval_token: expect.stringMatching(/^00000000-0000-4000-8000-/),
      approval_token_expires_at: "2026-10-26T10:30:00.000Z", // now + 30 min approval window
    });
    expect(w.notifier.receptionApproval).toHaveBeenCalledWith(expect.objectContaining({ pipelineId: "p1", approvalWindowMinutes: 30 }));
    expect(w.pipeline().front_desk_notified_via).toBe("email");
  });

  it("a double tap is harmless: the second answer reports the current state and changes nothing", async () => {
    const w = makeWorld({ pipeline: { stage: "offer_sent" }, offers: [offerRow("o1", "a", TOKEN_A)] });
    await respondToOffer(w.deps, TOKEN_A, "accepted", "link");
    const again = await respondToOffer(w.deps, TOKEN_A, "accepted", "link");
    expect(again).toEqual({ state: "accepted" });
    expect(w.notifier.receptionApproval).toHaveBeenCalledTimes(1);
    expect(w.tables.recovery_pipeline_history?.filter((h) => h.note === "Pat A. replied YES.")).toHaveLength(1);
  });

  it("answering NO after YES does not undo the YES", async () => {
    const w = makeWorld({ pipeline: { stage: "offer_sent" }, offers: [offerRow("o1", "a", TOKEN_A)] });
    await respondToOffer(w.deps, TOKEN_A, "accepted", "link");
    expect(await respondToOffer(w.deps, TOKEN_A, "declined", "link")).toEqual({ state: "accepted" });
    expect(w.pipeline().stage).toBe("waiting_staff_approval");
  });

  it("NO: logs it and offers the slot to the next patient straight away", async () => {
    const w = makeWorld({ pipeline: { stage: "offer_sent", waitlist_patient_id: "a" }, offers: [offerRow("o1", "a", TOKEN_A)] });
    const result = await respondToOffer(w.deps, TOKEN_A, "declined", "link");
    expect(result).toEqual({ state: "declined" });
    expect(w.offers().map((o) => [o.waitlist_patient_id, o.response])).toEqual([["a", "declined"], ["b", "pending"]]);
    expect(w.pipeline()).toMatchObject({ stage: "offer_sent", waitlist_patient_id: "b" });
    expect(w.sentOffers).toHaveLength(1);
  });

  it("NO with nobody left closes the card as expired", async () => {
    const w = makeWorld({ patients: [patientRow("a")], pipeline: { stage: "offer_sent" }, offers: [offerRow("o1", "a", TOKEN_A)] });
    await respondToOffer(w.deps, TOKEN_A, "declined", "link");
    expect(w.pipeline().stage).toBe("expired_manual");
  });

  it("an expired offer cannot be answered", async () => {
    const w = makeWorld({ pipeline: { stage: "offer_sent" }, offers: [offerRow("o1", "a", TOKEN_A, { offer_expires_at: "2026-10-26T09:59:00Z" })] });
    expect(await respondToOffer(w.deps, TOKEN_A, "accepted", "link")).toEqual({ state: "expired" });
    expect(w.pipeline().stage).toBe("offer_sent");
    expect(w.offers()[0]?.response).toBe("pending");
  });

  it("a slot that is already filled or closed is unavailable", async () => {
    for (const stage of ["slot_recovered", "expired_manual"]) {
      const w = makeWorld({ pipeline: { stage }, offers: [offerRow("o1", "a", TOKEN_A)] });
      expect(await respondToOffer(w.deps, TOKEN_A, "accepted", "link")).toEqual({ state: "slot_unavailable" });
    }
  });

  it("never loses a YES when the card moved first (race)", async () => {
    const w = makeWorld({ pipeline: { stage: "offer_sent" }, offers: [offerRow("o1", "a", TOKEN_A)] });
    // Make the stage move fail like a lost race.
    w.failOn("recovery_pipeline", "update");
    const result = await respondToOffer(w.deps, TOKEN_A, "accepted", "link");
    expect(result).toEqual({ state: "accepted" });
    expect(w.offers()[0]?.response).toBe("accepted");
    expect(w.history().some((h) => h.includes("replied YES, but the card could not be moved"))).toBe(true);
  });

  it("a YES for a card that is already waiting for approval is recorded with a warning", async () => {
    const w = makeWorld({ pipeline: { stage: "waiting_staff_approval" }, offers: [offerRow("o2", "b", TOKEN_B)] });
    expect(await respondToOffer(w.deps, TOKEN_B, "accepted", "link")).toEqual({ state: "accepted" });
    expect(w.pipeline().stage).toBe("waiting_staff_approval");
    expect(w.history().some((h) => h.includes("already in"))).toBe(true);
  });
});
