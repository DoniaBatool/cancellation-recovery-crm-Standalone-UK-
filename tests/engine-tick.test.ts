import { describe, expect, it, vi } from "vitest";
import { runTick } from "@/lib/engine/tick";
import { NOW, makeWorld } from "./helpers/engine-world";

const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();
const minutesAhead = (m: number) => new Date(NOW.getTime() + m * 60_000).toISOString();

const offerSent = { stage: "offer_sent", waitlist_patient_id: "a" };
const pendingOffer = (over: Record<string, unknown> = {}) => ({
  id: "o1", pipeline_id: "p1", waitlist_patient_id: "a", response: "pending", offer_token: "t1", offer_expires_at: minutesAgo(1), ...over,
});

describe("tick: expired offers", () => {
  it("expires an overdue offer and offers the slot to the next patient", async () => {
    const w = makeWorld({ pipeline: offerSent, offers: [pendingOffer()] });
    const summary = await runTick(w.deps);
    expect(summary).toMatchObject({ expiredOffers: 1, advanced: 1 });
    expect(w.offers().find((o) => o.id === "o1")?.response).toBe("expired");
    expect(w.sentOffers).toHaveLength(1);
    expect(w.sentOffers[0]!.patient.id).not.toBe("a");
    expect(w.history().some((h) => h.includes("expired with no answer"))).toBe(true);
  });

  it("leaves an offer that is still open alone", async () => {
    const w = makeWorld({ pipeline: offerSent, offers: [pendingOffer({ offer_expires_at: minutesAhead(10) })] });
    expect(await runTick(w.deps)).toMatchObject({ expiredOffers: 0, advanced: 0 });
    expect(w.sentOffers).toHaveLength(0);
  });

  it("never touches an offer that was answered", async () => {
    const w = makeWorld({ pipeline: offerSent, offers: [pendingOffer({ response: "declined" })] });
    expect((await runTick(w.deps)).expiredOffers).toBe(0);
  });

  it("gives up and alerts reception when nobody is left", async () => {
    const w = makeWorld({ pipeline: offerSent, patients: [], offers: [pendingOffer()] });
    await runTick(w.deps);
    expect(w.pipeline().stage).toBe("expired_manual");
    expect(w.notifier.slotExpired).toHaveBeenCalledTimes(1);
  });

  it("running twice does not offer twice", async () => {
    const w = makeWorld({ pipeline: offerSent, offers: [pendingOffer()] });
    await runTick(w.deps);
    await runTick(w.deps);
    expect(w.sentOffers).toHaveLength(1);
  });
});

describe("tick: quiet hours resume", () => {
  const held = (resumeAt: string) => ({ clinic_id: "c1", key: "deferred:p1", value: { resume_at: resumeAt } });

  it("sends the held offer once quiet hours end, and clears the hold", async () => {
    const w = makeWorld({ pipeline: { stage: "cancellation_detected" } });
    w.tables.engine_state!.push(held(minutesAgo(1)));
    const summary = await runTick(w.deps);
    expect(summary.resumed).toBe(1);
    expect(w.sentOffers).toHaveLength(1);
    expect(w.tables.engine_state!.some((r) => r.key === "deferred:p1")).toBe(false);
  });

  it("waits while the hold is still in the future", async () => {
    const w = makeWorld({ pipeline: { stage: "cancellation_detected", detected_at: minutesAgo(1) } });
    w.tables.engine_state!.push(held(minutesAhead(30)));
    expect((await runTick(w.deps)).resumed).toBe(0);
    expect(w.sentOffers).toHaveLength(0);
    expect(w.tables.engine_state!.some((r) => r.key === "deferred:p1")).toBe(true);
  });

  it("drops the hold when the card already closed", async () => {
    const w = makeWorld({ pipeline: { stage: "expired_manual" } });
    w.tables.engine_state!.push(held(minutesAgo(1)));
    await runTick(w.deps);
    expect(w.tables.engine_state!.some((r) => r.key === "deferred:p1")).toBe(false);
    expect(w.sentOffers).toHaveLength(0);
  });
});

describe("tick: approval reminders and timeout", () => {
  const waiting = (over: Record<string, unknown> = {}) => ({
    stage: "waiting_staff_approval",
    waitlist_patient_id: "a",
    approval_token: "33333333-3333-4333-8333-333333333333",
    approval_requested_at: minutesAgo(16),
    approval_token_expires_at: minutesAhead(14),
    ...over,
  });

  it("sends one reminder at 50% of the window", async () => {
    const w = makeWorld({ pipeline: waiting() });
    expect((await runTick(w.deps)).reminded).toBe(1);
    expect(w.notifier.receptionApproval).toHaveBeenCalledWith(expect.objectContaining({ reminder: true }));
    expect((await runTick(w.deps)).reminded).toBe(0);
    expect(w.notifier.receptionApproval).toHaveBeenCalledTimes(1);
  });

  it("does not remind before the halfway point", async () => {
    const w = makeWorld({ pipeline: waiting({ approval_requested_at: minutesAgo(5), approval_token_expires_at: minutesAhead(25) }) });
    expect((await runTick(w.deps)).reminded).toBe(0);
  });

  it("closes the card and alerts when the slot is about to start unapproved", async () => {
    const soon = minutesAhead(30); // min_lead_minutes is 60
    const w = makeWorld({ pipeline: waiting(), event: { slot_datetime: soon } });
    const summary = await runTick(w.deps);
    expect(summary.timedOut).toBe(1);
    expect(w.pipeline().stage).toBe("expired_manual");
    expect(w.notifier.slotExpired).toHaveBeenCalledTimes(1);
  });
});

describe("tick: self-heal", () => {
  it("starts offers for a card stuck in cancellation_detected for over 2 minutes", async () => {
    const w = makeWorld({ pipeline: { stage: "cancellation_detected", detected_at: minutesAgo(3) } });
    expect((await runTick(w.deps)).healed).toBe(1);
    expect(w.pipeline().stage).toBe("offer_sent");
  });

  it("leaves a fresh card alone", async () => {
    const w = makeWorld({ pipeline: { stage: "cancellation_detected", detected_at: minutesAgo(1) } });
    expect((await runTick(w.deps)).healed).toBe(0);
    expect(w.pipeline().stage).toBe("cancellation_detected");
  });

  it("does nothing while the engine is off (reception starts offers by hand)", async () => {
    const w = makeWorld({ pipeline: { stage: "cancellation_detected", detected_at: minutesAgo(10) }, config: { engine_enabled: false } });
    expect((await runTick(w.deps)).healed).toBe(0);
    expect(w.pipeline().stage).toBe("cancellation_detected");
  });
});

describe("tick: failures", () => {
  it("one failing step does not stop the others", async () => {
    const w = makeWorld({ pipeline: { stage: "cancellation_detected", detected_at: minutesAgo(10) } });
    w.failOn("engine_state", "select"); // breaks the quiet-hours step
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const summary = await runTick(w.deps);
    spy.mockRestore();
    expect(summary.resumed).toBe(0);
    expect(summary.healed).toBe(1); // self-heal still ran
  });
});
