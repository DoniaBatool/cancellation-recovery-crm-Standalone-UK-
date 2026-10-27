import { describe, expect, it } from "vitest";
import { handleInboundSms, handleSmsStatus } from "@/lib/engine/inbound-sms";
import { makeWorld, patientRow } from "./helpers/engine-world";

const PHONE = "+447700900001";
const offerSent = { stage: "offer_sent", waitlist_patient_id: "a" };
const open = (over: Record<string, unknown> = {}) => ({
  id: "o1", pipeline_id: "p1", waitlist_patient_id: "a", response: "pending", offer_token: "00000000-0000-4000-8000-0000000000a1",
  offer_expires_at: "2026-10-26T10:20:00Z", offered_at: "2026-10-26T09:50:00Z", ...over,
});
const reply = (w: ReturnType<typeof makeWorld>, body: string, sid = "SM" + Math.random()) => handleInboundSms(w.deps, { from: PHONE, body, messageSid: sid });
const patients = [patientRow("a", { phone: PHONE }), patientRow("b", { phone: "+447700900002" }), patientRow("c", { phone: "+447700900003" })];

describe("inbound SMS: YES / NO", () => {
  it("YES moves the card to waiting approval and confirms by text", async () => {
    const w = makeWorld({ pipeline: offerSent, patients, offers: [open()] });
    const { reply: text } = await reply(w, "Yes!");
    expect(text).toBe("Thanks! Smile Dentals will confirm your booking shortly.");
    expect(w.pipeline().stage).toBe("waiting_staff_approval");
    expect(w.offers()[0]).toMatchObject({ response: "accepted", responded_via: "sms_reply" });
    expect(w.notifier.receptionApproval).toHaveBeenCalledTimes(1);
  });

  it("NO declines and offers the next patient", async () => {
    const w = makeWorld({ pipeline: offerSent, patients, offers: [open()] });
    expect((await reply(w, "no")).reply).toBe("No problem, we'll keep you on the list.");
    expect(w.offers()[0]!.response).toBe("declined");
    expect(w.sentOffers).toHaveLength(1);
    expect(w.sentOffers[0]!.patient.id).not.toBe("a");
  });

  it("YES with no open offer says the slot has gone", async () => {
    const w = makeWorld({ pipeline: offerSent, patients, offers: [] });
    expect((await reply(w, "yes")).reply).toBe("Sorry, that slot has now gone. We'll text you next time.");
  });

  it("YES after the offer expired says the slot has gone and changes nothing", async () => {
    const w = makeWorld({ pipeline: offerSent, patients, offers: [open({ offer_expires_at: "2026-10-26T09:59:00Z" })] });
    expect((await reply(w, "yes")).reply).toContain("slot has now gone");
    expect(w.pipeline().stage).toBe("offer_sent");
  });

  it("a shared phone answers the most recent offer", async () => {
    const family = [patientRow("a", { phone: PHONE }), patientRow("b", { phone: PHONE }), patientRow("c")];
    const older = open({ id: "o1", waitlist_patient_id: "a", offer_token: "00000000-0000-4000-8000-0000000000a1", offered_at: "2026-10-26T09:40:00Z" });
    const newer = open({ id: "o2", waitlist_patient_id: "b", offer_token: "00000000-0000-4000-8000-0000000000b2", offered_at: "2026-10-26T09:55:00Z" });
    const w = makeWorld({ pipeline: { stage: "offer_sent", waitlist_patient_id: "b" }, patients: family, offers: [older, newer] });
    await reply(w, "YES");
    expect(w.offers().find((o) => o.id === "o2")!.response).toBe("accepted");
    expect(w.pipeline().waitlist_patient_id).toBe("b");
  });
});

describe("inbound SMS: STOP / START", () => {
  it("STOP opts out, deactivates, declines the pending offer and moves on", async () => {
    const w = makeWorld({ pipeline: offerSent, patients, offers: [open()] });
    const { reply: text } = await reply(w, "STOP");
    expect(text).toBe("You won't get more texts from Smile Dentals. Reply START to rejoin.");
    const row = w.tables.waitlist!.find((p) => p.id === "a")!;
    expect(row).toMatchObject({ sms_opt_out: true, is_active: false });
    expect(row.sms_opt_out_at).toBeTruthy();
    expect(w.offers()[0]!.response).toBe("declined");
    expect(w.sentOffers).toHaveLength(1);
    expect(w.sentOffers[0]!.patient.id).not.toBe("a");
  });

  it("START brings them back", async () => {
    const w = makeWorld({ patients: [patientRow("a", { phone: PHONE, sms_opt_out: true, is_active: false })] });
    const { reply: text } = await reply(w, "start");
    expect(text).toContain("back on the list");
    expect(w.tables.waitlist![0]).toMatchObject({ sms_opt_out: false, is_active: true });
  });
});

describe("inbound SMS: other cases", () => {
  it("an unknown reply is noted for reception and acknowledged", async () => {
    const w = makeWorld({ pipeline: offerSent, patients, offers: [open()] });
    expect((await reply(w, "can I come at 5 instead?")).reply).toBe("Thanks, the practice will get back to you.");
    expect(w.history().some((h) => h.includes('Patient replied: "can I come at 5 instead?"'))).toBe(true);
    expect(w.pipeline().stage).toBe("offer_sent");
  });

  it("logs every inbound text, and ignores a repeated MessageSid", async () => {
    const w = makeWorld({ pipeline: offerSent, patients, offers: [open()] });
    await reply(w, "yes", "SMDUP");
    const second = await reply(w, "yes", "SMDUP");
    expect(second.reply).toBeNull();
    expect(w.tables.messages!.filter((m) => m.direction === "in")).toHaveLength(1);
  });

  it("ignores a number that is not on any waitlist", async () => {
    const w = makeWorld({ patients });
    expect(await handleInboundSms(w.deps, { from: "+447999999999", body: "YES", messageSid: "SMX" })).toEqual({ reply: null });
    expect(w.tables.messages ?? []).toHaveLength(0);
  });
});

describe("SMS delivery status", () => {
  const out = (over: Record<string, unknown> = {}) => ({
    id: "m1", clinic_id: "c1", pipeline_id: "p1", offer_id: "o1", channel: "sms", direction: "out", provider_id: "SM1", status: "queued", ...over,
  });

  it("updates the status", async () => {
    const w = makeWorld({ pipeline: offerSent, patients });
    w.tables.messages = [out()];
    await handleSmsStatus(w.deps, { messageSid: "SM1", status: "delivered" });
    expect(w.tables.messages[0]).toMatchObject({ status: "delivered", error: null });
  });

  it("a failed SMS with no email sent leaves a 'call patient' note", async () => {
    const w = makeWorld({ pipeline: offerSent, patients });
    w.tables.messages = [out()];
    await handleSmsStatus(w.deps, { messageSid: "SM1", status: "undelivered", errorCode: "30003" });
    expect(w.tables.messages[0]).toMatchObject({ status: "undelivered", error: "Twilio error 30003" });
    expect(w.history()).toContain("SMS failed — call patient.");
  });

  it("a failed SMS is fine when the email went out", async () => {
    const w = makeWorld({ pipeline: offerSent, patients });
    w.tables.messages = [out(), { id: "m2", clinic_id: "c1", pipeline_id: "p1", offer_id: "o1", channel: "email", direction: "out", provider_id: null, status: "sent" }];
    await handleSmsStatus(w.deps, { messageSid: "SM1", status: "failed" });
    expect(w.history()).not.toContain("SMS failed — call patient.");
  });

  it("an unknown MessageSid does nothing", async () => {
    const w = makeWorld({ pipeline: offerSent, patients });
    await handleSmsStatus(w.deps, { messageSid: "NOPE", status: "failed" });
    expect(w.history()).toHaveLength(0);
  });
});
