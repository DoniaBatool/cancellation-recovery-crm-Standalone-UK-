import { describe, expect, it, vi } from "vitest";
import {
  ingestCancellation,
  slotWindowStatus,
  windowNote,
  type IntakeConfig,
  type IntakeInput,
} from "@/lib/engine/intake";
import { fail, fakeDb, ok, type Call } from "./helpers/fake-db";

const NOW = new Date("2027-01-15T10:00:00Z");
const hours = (n: number) => new Date(NOW.getTime() + n * 3_600_000);

const config: IntakeConfig = {
  price_cleaning: 60,
  price_consultation: 50,
  price_filling: 120,
  price_extraction: 150,
  price_crown: 600,
  price_implant: 2000,
  price_whitening: 300,
  price_default: 99,
  min_lead_minutes: 60,
  max_horizon_hours: 72,
  engine_enabled: true,
};

const base = (over: Partial<IntakeInput> = {}): IntakeInput => ({
  clinicId: "c1",
  clinicTimezone: "Europe/London",
  config,
  slotDatetime: hours(24),
  slotDurationMinutes: 30,
  procedureType: "filling",
  doctorId: "dr-patel",
  doctorName: "Dr Patel",
  pmsSource: "manual",
  triggeredBy: "front_desk",
  logNote: "Cancellation added manually by ann@clinic.co.uk",
  now: NOW,
  ...over,
});

describe("slotWindowStatus", () => {
  it("classifies the slot", () => {
    expect(slotWindowStatus(hours(-1), NOW, 60, 72)).toBe("past");
    expect(slotWindowStatus(NOW, NOW, 60, 72)).toBe("past");
    expect(slotWindowStatus(hours(0.5), NOW, 60, 72)).toBe("too_soon");
    expect(slotWindowStatus(hours(1), NOW, 60, 72)).toBe("ok");
    expect(slotWindowStatus(hours(72), NOW, 60, 72)).toBe("ok");
    expect(slotWindowStatus(hours(73), NOW, 60, 72)).toBe("too_far");
  });

  it("has a note for every blocked case and none for ok", () => {
    expect(windowNote("ok", 60, 72)).toBeNull();
    expect(windowNote("past", 60, 72)).toMatch(/past/);
    expect(windowNote("too_soon", 60, 72)).toMatch(/60 minutes/);
    expect(windowNote("too_far", 60, 72)).toMatch(/72 hours/);
  });
});

function happyHandler(c: Call) {
  if (c.table === "cancellation_events" && c.op === "insert") return ok({ id: "e1" });
  if (c.table === "recovery_pipeline" && c.op === "insert") return ok({ id: "p1" });
  return ok();
}

describe("ingestCancellation", () => {
  it("creates the event, the pipeline row and a history row", async () => {
    const { db, calls } = fakeDb(happyHandler);
    const result = await ingestCancellation(db, base());
    expect(result).toMatchObject({
      duplicate: false,
      eventId: "e1",
      pipelineId: "p1",
      stage: "cancellation_detected",
      windowStatus: "ok",
      shouldStartOffers: true,
    });

    const pipeline = calls.find((c) => c.table === "recovery_pipeline")!;
    expect(pipeline.payload).toMatchObject({ clinic_id: "c1", cancellation_event_id: "e1", procedure_price: 120 });

    const history = calls.filter((c) => c.table === "recovery_pipeline_history");
    expect(history).toHaveLength(1);
    expect(history[0]?.payload).toMatchObject({ from_stage: null, to_stage: "cancellation_detected", triggered_by: "front_desk" });
  });

  it("uses the default price for a missing procedure", async () => {
    const { db, calls } = fakeDb(happyHandler);
    await ingestCancellation(db, base({ procedureType: null }));
    expect(calls.find((c) => c.table === "recovery_pipeline")!.payload).toMatchObject({ procedure_price: 99 });
  });

  it("logs but does not offer a slot that is too soon, and adds a second note", async () => {
    const { db, calls } = fakeDb(happyHandler);
    const result = await ingestCancellation(db, base({ slotDatetime: hours(0.25) }));
    expect(result.windowStatus).toBe("too_soon");
    expect(result.shouldStartOffers).toBe(false);
    expect(calls.filter((c) => c.table === "recovery_pipeline_history")).toHaveLength(2);
  });

  it("does not start offers when the engine is off", async () => {
    const { db } = fakeDb(happyHandler);
    const result = await ingestCancellation(db, base({ config: { ...config, engine_enabled: false } }));
    expect(result.shouldStartOffers).toBe(false);
  });

  it("returns the existing card for a duplicate PMS appointment", async () => {
    const { db, calls } = fakeDb((c) => {
      if (c.table === "cancellation_events" && c.op === "select") return ok({ id: "e0" });
      if (c.table === "recovery_pipeline" && c.op === "select") return ok({ id: "p0", stage: "offer_sent" });
      return ok();
    });
    const result = await ingestCancellation(db, base({ pmsSource: "dentally", pmsAppointmentId: "A-1" }));
    expect(result).toMatchObject({ duplicate: true, eventId: "e0", pipelineId: "p0", stage: "offer_sent", shouldStartOffers: false });
    expect(calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("rolls the event back when the pipeline insert fails", async () => {
    const { db, calls } = fakeDb((c) => {
      if (c.table === "cancellation_events" && c.op === "insert") return ok({ id: "e1" });
      if (c.table === "recovery_pipeline" && c.op === "insert") return fail();
      return ok();
    });
    await expect(ingestCancellation(db, base())).rejects.toMatchObject({ code: "pipeline_insert_failed" });
    const rollback = calls.find((c) => c.op === "delete")!;
    expect(rollback.table).toBe("cancellation_events");
    expect(rollback.filters).toEqual([["id", "e1"]]);
  });

  it("fails cleanly when the event insert fails", async () => {
    const { db } = fakeDb(() => fail());
    await expect(ingestCancellation(db, base())).rejects.toMatchObject({ code: "event_insert_failed" });
  });

  it("still returns the card when the history row cannot be written", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = fakeDb((c) => (c.table === "recovery_pipeline_history" ? fail() : happyHandler(c)));
    await expect(ingestCancellation(db, base())).resolves.toMatchObject({ pipelineId: "p1" });
    spy.mockRestore();
  });
});
