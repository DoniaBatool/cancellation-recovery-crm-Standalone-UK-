import { describe, expect, it } from "vitest";
import { advance, giveUp, offerNext, startOffers } from "@/lib/engine/offer";
import { NOW, makeWorld, patientRow } from "./helpers/engine-world";

describe("startOffers", () => {
  it("offers the best match, moves the card to offer_sent and sends the offer", async () => {
    const w = makeWorld({
      patients: [patientRow("a"), patientRow("b", { preferred_procedures: ["cleaning"] }), patientRow("c")],
    });
    const run = await startOffers(w.deps, "p1");

    expect(run).toEqual({ status: "offered", patientIds: ["b"] });
    expect(w.pipeline()).toMatchObject({ stage: "offer_sent", waitlist_patient_id: "b" });
    expect(w.offers()).toHaveLength(1);
    expect(w.offers()[0]).toMatchObject({ waitlist_patient_id: "b", offer_token: "00000000-0000-4000-8000-000000000001" });
    expect(w.offers()[0]?.offer_expires_at).toBe("2026-10-26T10:30:00.000Z"); // now + 30 min
    expect(w.sentOffers).toHaveLength(1);
    expect(w.sentOffers[0]).toMatchObject({ offerToken: "00000000-0000-4000-8000-000000000001", channels: ["email"], preferredDoctorMatch: "any" });
    expect(w.history().some((h) => h.startsWith("Offer sent to Pat B."))).toBe(true);
    expect(w.tables.waitlist?.find((p) => p.id === "b")?.last_contacted_at).toBe(NOW.toISOString());
  });

  it("only starts from cancellation_detected", async () => {
    const w = makeWorld({ pipeline: { stage: "offer_sent" } });
    expect((await startOffers(w.deps, "p1")).status).toBe("skipped");
    expect(w.offers()).toHaveLength(0);
  });

  it("batch strategy offers to batch_size patients at once", async () => {
    const w = makeWorld({ config: { offer_strategy: "batch", batch_size: 2 } });
    const run = await startOffers(w.deps, "p1");
    expect(run.status).toBe("offered");
    expect(w.offers()).toHaveLength(2);
    expect(w.sentOffers).toHaveLength(2);
    expect(new Set(w.offers().map((o) => o.offer_token)).size).toBe(2);
  });

  it("skips patients with no usable channel (email-only notifier, phone-only patient)", async () => {
    const w = makeWorld({ patients: [patientRow("phone-only", { email: null }), patientRow("mail", { phone: null })] });
    await startOffers(w.deps, "p1");
    expect(w.offers().map((o) => o.waitlist_patient_id)).toEqual(["mail"]);
  });

  it("gives up with 'no waitlist match' when nobody can be offered", async () => {
    const w = makeWorld({ patients: [patientRow("far", { max_notice_hours: 48 })] });
    const run = await startOffers(w.deps, "p1");
    expect(run).toEqual({ status: "gave_up", reason: "no waitlist match" });
    expect(w.pipeline()).toMatchObject({ stage: "expired_manual", notes: "No waitlist match" });
    expect(w.notifier.slotExpired).toHaveBeenCalledWith(expect.objectContaining({ reason: "no waitlist match", offeredCount: 0 }));
  });

  it("gives up when the engine is off", async () => {
    const w = makeWorld({ config: { engine_enabled: false } });
    expect((await startOffers(w.deps, "p1")).status).toBe("gave_up");
    expect(w.pipeline().stage).toBe("expired_manual");
    expect(w.offers()).toHaveLength(0);
  });

  it("gives up when the slot starts in less than min_lead_minutes", async () => {
    const w = makeWorld({ event: { slot_datetime: "2026-10-26T10:30:00Z" } });
    expect(await startOffers(w.deps, "p1")).toEqual({ status: "gave_up", reason: "slot too close" });
  });

  it("gives up when the offer limit is reached", async () => {
    const w = makeWorld({
      config: { max_offers_per_slot: 1 },
      pipeline: { stage: "offer_sent" },
      offers: [{ id: "o0", pipeline_id: "p1", waitlist_patient_id: "a", response: "declined" }],
    });
    const run = await offerNext(w.deps, "p1");
    expect(run).toMatchObject({ status: "gave_up", reason: expect.stringContaining("offer limit") });
  });

  it("holds the offer during quiet hours and keeps the time in engine_state", async () => {
    // 21:00 GMT on Monday: quiet until 08:00 on Tuesday. Slot is Tuesday 15:00.
    const w = makeWorld({ now: new Date("2026-10-26T21:00:00Z"), event: { slot_datetime: "2026-10-27T15:00:00Z" } });
    const run = await startOffers(w.deps, "p1");
    expect(run).toEqual({ status: "deferred", resumeAt: "2026-10-27T08:00:00.000Z" });
    expect(w.pipeline().stage).toBe("cancellation_detected");
    expect(w.offers()).toHaveLength(0);
    expect(w.tables.engine_state?.[0]).toMatchObject({ clinic_id: "c1", key: "deferred:p1", value: { resume_at: "2026-10-27T08:00:00.000Z" } });
    expect(w.history().some((h) => h.includes("quiet hours"))).toBe(true);
  });

  it("gives up in quiet hours when the slot starts before they end", async () => {
    const w = makeWorld({ now: new Date("2026-10-26T21:00:00Z"), event: { slot_datetime: "2026-10-27T07:00:00Z" } });
    expect(await startOffers(w.deps, "p1")).toMatchObject({ status: "gave_up" });
  });

  it("a failed send keeps the card in offer_sent and leaves a note for reception", async () => {
    const w = makeWorld();
    w.notifier.offerOut.mockResolvedValueOnce([]);
    await startOffers(w.deps, "p1");
    expect(w.pipeline().stage).toBe("offer_sent");
    expect(w.history().some((h) => h.includes("could not be delivered"))).toBe(true);
  });

  it("a notifier that throws never breaks the engine", async () => {
    const w = makeWorld();
    w.notifier.offerOut.mockRejectedValueOnce(new Error("smtp down"));
    const run = await startOffers(w.deps, "p1");
    expect(run.status).toBe("offered");
    expect(w.pipeline().stage).toBe("offer_sent");
  });

  it("withdraws its offers when someone else moved the card first", async () => {
    const w = makeWorld();
    // Another process closes the card between loading it and moving it.
    const original = w.tables.recovery_pipeline![0]!;
    const realFrom = (w.db as unknown as { from: (t: string) => unknown }).from.bind(w.db);
    let hijacked = false;
    (w.db as unknown as { from: unknown }).from = (table: string) => {
      if (table === "recovery_pipeline" && !hijacked) {
        const b = realFrom(table) as { update: (p: unknown) => unknown };
        const update = b.update;
        b.update = (p: unknown) => {
          if (!hijacked) {
            hijacked = true;
            original.stage = "expired_manual";
          }
          return update(p);
        };
        return b;
      }
      return realFrom(table);
    };
    const run = await startOffers(w.deps, "p1");
    expect(run.status).toBe("skipped");
    expect(w.offers().every((o) => o.response === "expired")).toBe(true);
    expect(w.sentOffers).toHaveLength(0);
  });
});

describe("advance", () => {
  it("offers the next patient after a decline", async () => {
    const w = makeWorld({
      pipeline: { stage: "offer_sent", waitlist_patient_id: "a" },
      offers: [{ id: "o1", pipeline_id: "p1", waitlist_patient_id: "a", response: "declined", offer_expires_at: "2026-10-26T10:15:00Z" }],
    });
    const run = await advance(w.deps, "p1");
    expect(run.status).toBe("offered");
    expect(w.offers().map((o) => o.waitlist_patient_id)).toEqual(["a", "b"]);
    expect(w.pipeline()).toMatchObject({ stage: "offer_sent", waitlist_patient_id: "b" });
  });

  it("waits while another offer (batch) is still open", async () => {
    const w = makeWorld({
      pipeline: { stage: "offer_sent" },
      offers: [
        { id: "o1", pipeline_id: "p1", waitlist_patient_id: "a", response: "declined" },
        { id: "o2", pipeline_id: "p1", waitlist_patient_id: "b", response: "pending", offer_expires_at: "2026-10-26T10:20:00Z" },
      ],
    });
    expect(await advance(w.deps, "p1")).toMatchObject({ status: "skipped" });
    expect(w.offers()).toHaveLength(2);
  });

  it("gives up when nobody is left, and counts the patients offered", async () => {
    const w = makeWorld({
      patients: [patientRow("a")],
      pipeline: { stage: "offer_sent" },
      offers: [{ id: "o1", pipeline_id: "p1", waitlist_patient_id: "a", response: "declined" }],
    });
    expect(await advance(w.deps, "p1")).toEqual({ status: "gave_up", reason: "nobody accepted" });
    expect(w.notifier.slotExpired).toHaveBeenCalledWith(expect.objectContaining({ offeredCount: 1 }));
    expect(w.pipeline()).toMatchObject({ stage: "expired_manual" });
  });

  it("does nothing when the card is not in offer_sent", async () => {
    const w = makeWorld({ pipeline: { stage: "waiting_staff_approval" } });
    expect(await advance(w.deps, "p1")).toMatchObject({ status: "skipped" });
  });
});

describe("giveUp", () => {
  it("expires pending offers, closes the card and alerts reception", async () => {
    const w = makeWorld({
      pipeline: { stage: "offer_sent" },
      offers: [{ id: "o1", pipeline_id: "p1", waitlist_patient_id: "a", response: "pending" }],
    });
    expect(await giveUp(w.deps, "p1", "slot too close")).toEqual({ status: "gave_up", reason: "slot too close" });
    expect(w.offers()[0]?.response).toBe("expired");
    expect(w.pipeline().stage).toBe("expired_manual");
    expect(w.notifier.slotExpired).toHaveBeenCalledTimes(1);
  });

  it("ignores an already closed card", async () => {
    const w = makeWorld({ pipeline: { stage: "slot_recovered" } });
    expect((await giveUp(w.deps, "p1", "x")).status).toBe("skipped");
    expect(w.notifier.slotExpired).not.toHaveBeenCalled();
  });
});
