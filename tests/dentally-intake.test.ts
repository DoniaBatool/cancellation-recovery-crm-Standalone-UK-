import { describe, expect, it, vi } from "vitest";
import type { DentallyClient } from "@/lib/dentally/client";
import { handleDentallyWebhook, parseDentallyEvent, runDentallyPoll } from "@/lib/engine/dentally-intake";
import { makeWorld } from "./helpers/engine-world";

const SECRET = "s".repeat(24);
const FUTURE = "2026-10-26T16:00:00Z"; // 6 h after NOW, inside the window

const cancelled = (over: Record<string, unknown> = {}) => ({
  id: 501, start_time: FUTURE, finish_time: "2026-10-26T16:30:00Z", state: "Cancelled", reason: "Filling", practitioner_id: "d1", patient_id: 7, ...over,
});

function fakeClient(over: Partial<Record<keyof DentallyClient, unknown>> = {}): DentallyClient {
  return {
    dentallyFetch: vi.fn(),
    getAppointment: vi.fn().mockResolvedValue(cancelled()),
    listAppointments: vi.fn().mockResolvedValue([]),
    getPatient: vi.fn().mockResolvedValue({ first_name: "Tom", last_name: "Lee", email_address: "tom@example.com" }),
    listPractitioners: vi.fn().mockResolvedValue([{ id: 9, first_name: "Dr", last_name: "API" }]),
    listTreatments: vi.fn().mockResolvedValue([]),
    ...over,
  } as unknown as DentallyClient;
}

const events = (w: ReturnType<typeof makeWorld>) => w.tables.cancellation_events!.filter((e) => e.pms_source === "dentally");

describe("parseDentallyEvent", () => {
  it("reads the action and the id from common shapes", () => {
    expect(parseDentallyEvent({ event: "appointment.updated", appointment: { id: 5 } })).toMatchObject({ action: "updated", appointmentId: "5" });
    expect(parseDentallyEvent({ type: "appointment_created", data: { id: "6" } })).toMatchObject({ action: "created", appointmentId: "6" });
    expect(parseDentallyEvent({ topic: "appointments/deleted", id: 7 })).toMatchObject({ action: "deleted", appointmentId: "7" });
  });
  it("ignores other events and garbage", () => {
    expect(parseDentallyEvent({ event: "patient.updated", data: { id: 1 } })).toBeNull();
    expect(parseDentallyEvent(null)).toBeNull();
    expect(parseDentallyEvent("x")).toBeNull();
  });
});

describe("Dentally webhook", () => {
  const input = (w: ReturnType<typeof makeWorld>, over: Record<string, unknown> = {}) => ({
    secretFromPath: SECRET, expectedSecret: SECRET, payload: { event: "appointment.updated", appointment: { id: 501 } }, deps: w.deps, client: fakeClient(), ...over,
  });

  it("rejects a wrong secret and does nothing", async () => {
    const w = makeWorld({});
    expect((await handleDentallyWebhook(input(w, { secretFromPath: "wrong-wrong-wrong-wrong!" }))).status).toBe(401);
    expect(events(w)).toHaveLength(0);
  });

  it("404 when no secret is configured", async () => {
    const w = makeWorld({});
    expect((await handleDentallyWebhook(input(w, { expectedSecret: null }))).status).toBe(404);
  });

  it("a cancelled appointment becomes a card and offers start", async () => {
    const w = makeWorld({});
    expect((await handleDentallyWebhook(input(w))).status).toBe(200);
    expect(events(w)).toHaveLength(1);
    expect(events(w)[0]).toMatchObject({ pms_appointment_id: "501", procedure_type: "filling", cancelled_patient_name: "Tom Lee" });
    const card = w.tables.recovery_pipeline!.find((p) => p.cancellation_event_id === events(w)[0]!.id)!;
    expect(card.stage).toBe("offer_sent");
    expect(w.sentOffers).toHaveLength(1);
  });

  it("records last_webhook_at", async () => {
    const w = makeWorld({});
    await handleDentallyWebhook(input(w));
    expect(w.tables.engine_state!.find((r) => r.key === "last_webhook_at")?.value).toBe("2026-10-26T10:00:00.000Z");
  });

  it("is idempotent: the same event twice makes one card", async () => {
    const w = makeWorld({});
    await handleDentallyWebhook(input(w));
    await handleDentallyWebhook(input(w));
    expect(events(w)).toHaveLength(1);
  });

  it("re-fetches the appointment and ignores one that is not cancelled", async () => {
    const w = makeWorld({});
    const client = fakeClient({ getAppointment: vi.fn().mockResolvedValue(cancelled({ state: "Confirmed" })) });
    await handleDentallyWebhook(input(w, { client, payload: { event: "appointment.updated", appointment: { id: 501, state: "Cancelled" } } }));
    expect(events(w)).toHaveLength(0); // the payload said cancelled, the fetch said no: the fetch wins
  });

  it("ignores events that are not about appointments, but still answers 200", async () => {
    const w = makeWorld({});
    expect((await handleDentallyWebhook(input(w, { payload: { event: "payment.created", data: { id: 1 } } }))).status).toBe(200);
    expect(events(w)).toHaveLength(0);
  });

  it("a deleted appointment counts only when its slot is in the future", async () => {
    const w = makeWorld({});
    await handleDentallyWebhook(input(w, { payload: { event: "appointment.deleted", appointment: { id: 601, start_time: FUTURE } } }));
    expect(events(w)).toHaveLength(1);
    const w2 = makeWorld({});
    await handleDentallyWebhook(input(w2, { payload: { event: "appointment.deleted", appointment: { id: 602, start_time: "2026-10-25T10:00:00Z" } } }));
    expect(events(w2)).toHaveLength(0);
  });

  it("defers the work so the reply can go out first", async () => {
    const w = makeWorld({});
    const tasks: (() => Promise<void>)[] = [];
    await handleDentallyWebhook(input(w, { deps: { ...w.deps, defer: (t: () => Promise<void>) => tasks.push(t) } }));
    expect(events(w)).toHaveLength(0);
    await tasks[0]!();
    expect(events(w)).toHaveLength(1);
  });

  it("a broken Dentally lookup never throws out of the webhook", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const w = makeWorld({});
    const client = fakeClient({ getAppointment: vi.fn().mockRejectedValue(new Error("boom")) });
    expect((await handleDentallyWebhook(input(w, { client }))).status).toBe(200);
    spy.mockRestore();
  });

  it("a past slot is ignored (no card)", async () => {
    const w = makeWorld({});
    const client = fakeClient({ getAppointment: vi.fn().mockResolvedValue(cancelled({ start_time: "2026-10-26T08:00:00Z", finish_time: "2026-10-26T08:30:00Z" })) });
    await handleDentallyWebhook(input(w, { client }));
    expect(events(w)).toHaveLength(0);
  });
});

describe("Dentally poller", () => {
  it("ingests cancelled appointments, skips others, and saves last_poll_at", async () => {
    const w = makeWorld({});
    const client = fakeClient({ listAppointments: vi.fn().mockResolvedValue([cancelled(), cancelled({ id: 502, state: "Confirmed" })]) });
    const summary = await runDentallyPoll(w.deps, client);
    expect(summary).toEqual({ checked: 2, ingested: 1, error: null });
    expect(events(w)).toHaveLength(1);
    const state = (k: string) => w.tables.engine_state!.find((r) => r.key === k)?.value;
    expect(state("last_poll_at")).toBe("2026-10-26T10:00:00.000Z");
    expect(state("poll_failures")).toBe(0);
    expect(state("last_poll_changes_at")).toBe("2026-10-26T10:00:00.000Z");
  });

  it("asks for changes since last_poll_at minus 2 minutes", async () => {
    const w = makeWorld({});
    w.tables.engine_state!.push({ clinic_id: "c1", key: "last_poll_at", value: "2026-10-26T09:50:00.000Z" });
    const list = vi.fn().mockResolvedValue([]);
    await runDentallyPoll(w.deps, fakeClient({ listAppointments: list }));
    expect(list.mock.calls[0]![0].updatedSince.toISOString()).toBe("2026-10-26T09:48:00.000Z");
  });

  it("a second poll over the same appointment is a duplicate, not a second card", async () => {
    const w = makeWorld({});
    const client = fakeClient({ listAppointments: vi.fn().mockResolvedValue([cancelled()]) });
    await runDentallyPoll(w.deps, client);
    const again = await runDentallyPoll(w.deps, client);
    expect(again.ingested).toBe(0);
    expect(events(w)).toHaveLength(1);
  });

  it("counts failures in a row and reports the error without the token", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const w = makeWorld({});
    const { DentallyError } = await import("@/lib/dentally/client");
    const client = fakeClient({ listAppointments: vi.fn().mockRejectedValue(new DentallyError(503, "http_503", "Dentally answered 503.")) });
    expect((await runDentallyPoll(w.deps, client)).error).toBe("Dentally 503 http_503");
    await runDentallyPoll(w.deps, client);
    expect(w.tables.engine_state!.find((r) => r.key === "poll_failures")?.value).toBe(2);
    expect(w.tables.engine_state!.some((r) => r.key === "last_poll_at")).toBe(false);
    spy.mockRestore();
  });

  it("one bad appointment does not stop the rest", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const w = makeWorld({});
    const client = fakeClient({
      listAppointments: vi.fn().mockResolvedValue([cancelled({ id: 701 }), cancelled({ id: 702 })]),
      getPatient: vi.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValue({ first_name: "A", last_name: "B" }),
    });
    expect((await runDentallyPoll(w.deps, client)).ingested).toBe(2); // patient lookup is best effort
    spy.mockRestore();
  });
});
