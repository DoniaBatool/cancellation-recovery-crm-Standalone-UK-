import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/http";
import { isTransitionAllowed, logHistory, transitionStage } from "@/lib/pipeline";
import { fail, fakeDb, ok } from "./helpers/fake-db";

const NOW = new Date("2027-01-15T10:00:00Z");

describe("isTransitionAllowed", () => {
  it("follows the guide table", () => {
    expect(isTransitionAllowed("cancellation_detected", "offer_sent")).toBe(true);
    expect(isTransitionAllowed("offer_sent", "offer_sent")).toBe(true);
    expect(isTransitionAllowed("slot_recovered", "offer_sent")).toBe(false);
    expect(isTransitionAllowed("expired_manual", "slot_recovered")).toBe(false);
  });
});

describe("transitionStage", () => {
  it("rejects a disallowed move before touching the database", async () => {
    const { db, calls } = fakeDb(() => ok());
    await expect(
      transitionStage(db, { pipeline: { id: "p1", stage: "slot_recovered" }, to: "offer_sent", triggeredBy: "system" }),
    ).rejects.toMatchObject({ status: 409, code: "invalid_transition" });
    expect(calls).toHaveLength(0);
  });

  it("updates with the optimistic lock, sets the timestamp and writes history", async () => {
    const { db, calls } = fakeDb((c) => (c.op === "update" ? ok([{ id: "p1" }]) : ok()));
    const result = await transitionStage(db, {
      pipeline: { id: "p1", stage: "cancellation_detected" },
      to: "expired_manual",
      triggeredBy: "front_desk",
      note: "Closed by reception",
      fields: { revenue_saved: 0 },
      now: NOW,
    });
    expect(result).toEqual({ id: "p1", from: "cancellation_detected", to: "expired_manual" });

    const update = calls.find((c) => c.op === "update")!;
    expect(update.filters).toEqual([
      ["id", "p1"],
      ["stage", "cancellation_detected"],
    ]);
    expect(update.payload).toMatchObject({ stage: "expired_manual", expired_at: NOW.toISOString(), revenue_saved: 0 });

    const history = calls.find((c) => c.op === "insert")!;
    expect(history.table).toBe("recovery_pipeline_history");
    expect(history.payload).toEqual({
      pipeline_id: "p1",
      from_stage: "cancellation_detected",
      to_stage: "expired_manual",
      note: "Closed by reception",
      triggered_by: "front_desk",
    });
  });

  it("reports a stage conflict when no row matched", async () => {
    const { db, calls } = fakeDb(() => ok([]));
    await expect(
      transitionStage(db, { pipeline: { id: "p1", stage: "offer_sent" }, to: "slot_recovered", triggeredBy: "system" }),
    ).rejects.toMatchObject({ status: 409, code: "stage_conflict" });
    expect(calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("turns a database error into a 500", async () => {
    const { db } = fakeDb(() => fail());
    const error = await transitionStage(db, {
      pipeline: { id: "p1", stage: "offer_sent" },
      to: "slot_recovered",
      triggeredBy: "system",
    }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(500);
  });

  it("still succeeds when only the history row fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = fakeDb((c) => (c.op === "update" ? ok([{ id: "p1" }]) : fail("history down")));
    await expect(
      transitionStage(db, { pipeline: { id: "p1", stage: "offer_sent" }, to: "slot_recovered", triggeredBy: "system" }),
    ).resolves.toMatchObject({ to: "slot_recovered" });
    spy.mockRestore();
  });
});

describe("logHistory", () => {
  it("writes a note without changing the stage", async () => {
    const { db, calls } = fakeDb(() => ok());
    expect(await logHistory(db, { id: "p1", stage: "offer_sent" }, "Called the patient", "front_desk")).toBe(true);
    expect(calls[0]?.payload).toMatchObject({ from_stage: "offer_sent", to_stage: "offer_sent", note: "Called the patient" });
  });

  it("returns false when the insert fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = fakeDb(() => fail());
    expect(await logHistory(db, { id: "p1", stage: "offer_sent" }, "x")).toBe(false);
    spy.mockRestore();
  });
});
