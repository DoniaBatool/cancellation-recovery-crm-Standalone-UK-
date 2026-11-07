import { describe, expect, it, vi } from "vitest";
import { createSmsSender } from "@/lib/sms";
import { findOptOut, inheritedOptOut, loadOptedOutPhones, phoneKey } from "@/lib/sms-suppression";
import { memoryDb } from "./helpers/memory-db";
import { makeWorld, patientRow } from "./helpers/engine-world";
import { startOffers } from "@/lib/engine/offer";
import { handleInboundSms } from "@/lib/engine/inbound-sms";

const P = "+447700900001";
const STOPPED_AT = "2026-09-01T10:00:00.000Z";
const stopped = (id: string, over: Record<string, unknown> = {}) =>
  patientRow(id, { phone: P, sms_opt_out: true, sms_opt_out_at: STOPPED_AT, is_active: false, ...over });

describe("phone matching helpers", () => {
  it("compares numbers in E.164, whatever shape they were typed in", () => {
    expect(phoneKey("07700 900001")).toBe(P);
    expect(phoneKey("+44 7700 900001")).toBe(P);
    expect(phoneKey(null)).toBeNull();
    expect(findOptOut([{ phone: "07700 900001", sms_opt_out: true }], P)).not.toBeNull();
    expect(findOptOut([{ phone: P, sms_opt_out: false }], P)).toBeNull();
    expect(findOptOut([{ phone: "+447700900002", sms_opt_out: true }], P)).toBeNull();
  });

  it("a new row inherits the flag AND the original opt-out date", () => {
    expect(inheritedOptOut([{ phone: P, sms_opt_out: true, sms_opt_out_at: STOPPED_AT }], "07700 900001")).toEqual({ sms_opt_out: true, sms_opt_out_at: STOPPED_AT });
    expect(inheritedOptOut([{ phone: P, sms_opt_out: false }], P)).toBeNull();
  });

  it("loadOptedOutPhones lists opted-out numbers of one clinic, and returns null when it cannot read", async () => {
    const store = memoryDb({ waitlist: [stopped("a"), patientRow("b", { phone: "+447700900002" }), stopped("x", { clinic_id: "other", phone: "+447700900009" })] });
    expect([...(await loadOptedOutPhones(store.db, "c1"))!]).toEqual([P]);
    store.failOn("waitlist", "select");
    expect(await loadOptedOutPhones(store.db, "c1")).toBeNull();
  });
});

describe("offers: send is blocked by phone match", () => {
  it("another row of the clinic opted out on this number: no SMS, even though this row's own flag is false", async () => {
    const w = makeWorld({
      channels: ["email", "sms"],
      patients: [stopped("old"), patientRow("new", { phone: "07700 900001", sms_opt_out: false })],
    });
    await startOffers(w.deps, "p1");
    expect(w.sentOffers).toHaveLength(1);
    expect(w.sentOffers[0]!.patient.id).toBe("new");
    expect(w.sentOffers[0]!.channels).toEqual(["email"]);
    expect(w.offers()[0]!.template_version).toBe("offer-email-v1");
  });

  it("a patient who has only that phone number is not offered at all", async () => {
    const w = makeWorld({ channels: ["email", "sms"], patients: [stopped("old"), patientRow("new", { email: null, sms_opt_out: false })] });
    const run = await startOffers(w.deps, "p1");
    expect(run.status).toBe("gave_up");
    expect(w.sentOffers).toHaveLength(0);
  });

  it("a different number is unaffected, and so is the same number at another clinic", async () => {
    const w = makeWorld({
      channels: ["email", "sms"],
      patients: [stopped("other-clinic", { clinic_id: "c2" }), patientRow("fine", { phone: "+447700900002" })],
    });
    await startOffers(w.deps, "p1");
    expect(w.sentOffers[0]!.channels).toEqual(["sms", "email"]);
  });

  it("if the opt-out list cannot be read, SMS is off for everyone (email only)", async () => {
    const w = makeWorld({ channels: ["email", "sms"], patients: [patientRow("a", { phone: "+447700900002" })] });
    // 1st waitlist read = active patients (works), 2nd = opt-out list (fails)
    let waitlistReads = 0;
    const real = w.db.from.bind(w.db);
    const failing: Record<string, unknown> = { select: () => failing, eq: () => failing, then: (r: (v: unknown) => unknown) => r({ data: null, error: { message: "down" } }) };
    const deps = { ...w.deps, db: { from: (t: string) => (t === "waitlist" && ++waitlistReads === 2 ? failing : real(t as never)) } as unknown as typeof w.deps.db };
    await startOffers(deps, "p1");
    expect(w.sentOffers[0]!.channels).toEqual(["email"]);
  });
});

describe("SMS sender: the last gate", () => {
  const config = { accountSid: "AC1", authToken: "t", messagingServiceSid: null, smsFrom: "+447000000000", whatsappFrom: null };
  const msg = { to: P, body: "hello", clinicId: "c1" };

  it("sends nothing to a number that opted out on any row of the clinic, and writes no message row", async () => {
    const store = memoryDb({ waitlist: [stopped("old")] });
    const create = vi.fn().mockResolvedValue({ sid: "SM1" });
    const ok = await createSmsSender(config, store.db, "https://a.co", { messages: { create } }).send({ ...msg, patientId: "new-row-flag-false" });
    expect(ok).toBe(false);
    expect(create).not.toHaveBeenCalled();
    expect(store.tables.messages ?? []).toHaveLength(0);
  });

  it("matches the number even when it is written differently", async () => {
    const store = memoryDb({ waitlist: [stopped("old", { phone: "07700 900001" })] });
    const create = vi.fn().mockResolvedValue({ sid: "SM1" });
    expect(await createSmsSender(config, store.db, "https://a.co", { messages: { create } }).send(msg)).toBe(false);
    expect(create).not.toHaveBeenCalled();
  });

  it("still sends to a number that never opted out, and to the same number at another clinic's request", async () => {
    const store = memoryDb({ waitlist: [stopped("other-clinic", { clinic_id: "c2" })] });
    const create = vi.fn().mockResolvedValue({ sid: "SM1" });
    expect(await createSmsSender(config, store.db, "https://a.co", { messages: { create } }).send(msg)).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("fails closed: if opt-outs cannot be checked, nothing is sent", async () => {
    const store = memoryDb({ waitlist: [] });
    store.failOn("waitlist", "select");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const create = vi.fn().mockResolvedValue({ sid: "SM1" });
    expect(await createSmsSender(config, store.db, "https://a.co", { messages: { create } }).send(msg)).toBe(false);
    expect(create).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("START clears the flag for every row with that phone (the patient's own action)", () => {
  it("clears all rows of the number, including a re-added copy", async () => {
    const w = makeWorld({ patients: [stopped("old"), stopped("readded", { is_active: true }), patientRow("other", { phone: "+447700900002" })] });
    await handleInboundSms(w.deps, { from: P, body: "START", messageSid: "SMS1" });
    const rows = w.tables.waitlist!;
    expect(rows.filter((r) => r.phone === P).every((r) => r.sms_opt_out === false && r.sms_opt_out_at === null)).toBe(true);
    expect(rows.find((r) => r.id === "other")!.sms_opt_out).toBe(false);
  });

  it("STOP sets it on every row with the number", async () => {
    const w = makeWorld({ patients: [patientRow("a", { phone: P }), patientRow("b", { phone: P })] });
    await handleInboundSms(w.deps, { from: P, body: "STOP", messageSid: "SMS2" });
    expect(w.tables.waitlist!.every((r) => r.sms_opt_out === true && r.sms_opt_out_at)).toBe(true);
  });
});

describe("after the 30-day scrub the number still blocks SMS", () => {
  // What private.scrub_opted_out_waitlist() leaves behind: placeholder name, no email/notes, phone + flag + date kept.
  const scrubbed = (id: string, over: Record<string, unknown> = {}) =>
    stopped(id, { patient_name: "Opted out", email: null, notes: null, pms_patient_id: null, preferred_procedures: [], preferred_days: [], preferred_times: [], preferred_doctors: [], existing_patient: false, scrubbed_at: "2026-10-10T03:20:00.000Z", ...over });

  it("offer path: a new row with the same number gets no SMS", async () => {
    const w = makeWorld({ channels: ["email", "sms"], patients: [scrubbed("old"), patientRow("new", { phone: "07700 900001", sms_opt_out: false })] });
    await startOffers(w.deps, "p1");
    expect(w.sentOffers).toHaveLength(1);
    expect(w.sentOffers[0]!.patient.id).toBe("new");
    expect(w.sentOffers[0]!.channels).toEqual(["email"]);
  });

  it("lib/sms.ts send guard refuses the number and writes no message row", async () => {
    const config = { accountSid: "AC1", authToken: "t", messagingServiceSid: null, smsFrom: "+447000000000", whatsappFrom: null };
    const store = memoryDb({ waitlist: [scrubbed("old")] });
    const create = vi.fn().mockResolvedValue({ sid: "SM1" });
    expect(await createSmsSender(config, store.db, "https://a.co", { messages: { create } }).send({ to: P, body: "hi", clinicId: "c1" })).toBe(false);
    expect(create).not.toHaveBeenCalled();
    expect(store.tables.messages ?? []).toHaveLength(0);
  });

  it("inheritedOptOut still hands the original flag and date to a new row", () => {
    expect(inheritedOptOut([scrubbed("old")], "07700 900001")).toEqual({ sms_opt_out: true, sms_opt_out_at: STOPPED_AT });
  });

  it("START lifts the opt-out on the scrubbed row but does NOT switch it back on, and tells the patient to sign up again", async () => {
    const w = makeWorld({ patients: [scrubbed("old")] });
    const { reply } = await handleInboundSms(w.deps, { from: P, body: "START", messageSid: "SMS3" });
    expect(w.tables.waitlist!.find((r) => r.id === "old")).toMatchObject({ sms_opt_out: false, sms_opt_out_at: null, is_active: false, patient_name: "Opted out" });
    expect(reply).toMatch(/sign up again/);
    expect(reply).not.toMatch(/back on the list/);
  });

  it("START with one scrubbed and one ordinary row switches only the ordinary row back on", async () => {
    const w = makeWorld({ patients: [scrubbed("old"), stopped("kept")] });
    const { reply } = await handleInboundSms(w.deps, { from: P, body: "START", messageSid: "SMS4" });
    const rows = w.tables.waitlist!;
    expect(rows.find((r) => r.id === "old")).toMatchObject({ sms_opt_out: false, is_active: false });
    expect(rows.find((r) => r.id === "kept")).toMatchObject({ sms_opt_out: false, is_active: true });
    expect(reply).toMatch(/back on the list/);
  });
});
