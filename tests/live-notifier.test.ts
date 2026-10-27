import { describe, expect, it, vi } from "vitest";
import type { Mail, Mailer } from "@/lib/email";
import { createLiveNotifier } from "@/lib/engine/live-notifier";
import type { ConfirmationContext, OfferOutContext, ReceptionContext } from "@/lib/engine/notifier";
import { memoryDb } from "./helpers/memory-db";

const clinic = { id: "c1", name: "Smile Dentals", timezone: "Europe/London", address: "1 High St", phone: "020 0000 0000", contactEmail: "desk@example.com" };
const slot = { datetime: "2026-10-27T14:30:00Z", durationMinutes: 30, procedure: "Filling", doctorName: "Dr Ali" };
const patient = { id: "p1", name: "Sarah Khan", email: "sarah@example.com", phone: "+447700900001" };

function setup(opts: { fail?: boolean; slackFetch?: typeof fetch; withSlack?: boolean } = {}) {
  const sent: Mail[] = [];
  const mailer: Mailer = {
    async send(mail) {
      sent.push(mail);
      return opts.fail ? { ok: false, error: "smtp down" } : { ok: true, id: "m" };
    },
  };
  const store = memoryDb({});
  const notifier = createLiveNotifier({
    db: store.db,
    appUrl: "https://app.example.com",
    mailer,
    slack: opts.withSlack ? { botToken: "t", signingSecret: "s", channelId: "C1" } : null,
    shadow: { email: "test@operator.com", phone: "+447700900999" },
    fetchImpl: opts.slackFetch,
  });
  return { sent, store, notifier };
}

const offerCtx = (over: Partial<OfferOutContext> = {}): OfferOutContext => ({
  clinic, slot, patient, pipelineId: "pl1", offerId: "o1", offerToken: "tok-1",
  offerExpiresAt: "2026-10-26T10:30:00Z", offerExpiryMinutes: 30, channels: ["email"],
  preferredDoctorMatch: "any", shadowMode: false, ...over,
});

describe("live notifier: offers", () => {
  it("advertises email only when there is no SMS sender", () => {
    expect(setup().notifier.channels).toEqual(["email"]);
  });

  it("emails the offer with the confirm link and logs a message row", async () => {
    const { sent, store, notifier } = setup();
    const result = await notifier.offerOut(offerCtx());
    expect(result).toEqual(["email"]);
    expect(sent[0]).toMatchObject({ to: "sarah@example.com", fromName: "Smile Dentals", replyTo: "desk@example.com" });
    expect(sent[0]!.text).toContain("https://app.example.com/confirm/tok-1");
    expect(sent[0]!.text).toContain("30 minutes");
    expect(store.tables.messages![0]).toMatchObject({ channel: "email", direction: "out", to_or_from: "sarah@example.com", status: "sent", offer_id: "o1" });
  });

  it("shadow mode sends to the test inbox with a TEST prefix, never to the patient", async () => {
    const { sent, notifier } = setup();
    await notifier.offerOut(offerCtx({ shadowMode: true }));
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toBe("test@operator.com");
    expect(sent[0]!.subject).toContain("[TEST for Sarah Khan]");
  });

  it("returns nothing and logs a failed row when the email fails", async () => {
    const { store, notifier } = setup({ fail: true });
    expect(await notifier.offerOut(offerCtx())).toEqual([]);
    expect(store.tables.messages![0]).toMatchObject({ status: "failed", error: "smtp down" });
  });

  it("skips a patient with no email", async () => {
    const { sent, notifier } = setup();
    expect(await notifier.offerOut(offerCtx({ patient: { ...patient, email: null } }))).toEqual([]);
    expect(sent).toHaveLength(0);
  });

  it("flags the other-dentist case in the email", async () => {
    const { sent, notifier } = setup();
    await notifier.offerOut(offerCtx({ preferredDoctorMatch: "no" }));
    expect(sent[0]!.text).toContain("not your usual dentist");
  });
});

const recCtx = (over: Partial<ReceptionContext> = {}): ReceptionContext => ({
  clinic, slot, patient, pipelineId: "pl1", approvalToken: "33333333-3333-4333-8333-333333333333",
  approvalWindowMinutes: 30, price: 120, slackEnabled: false, slackMessageTs: null, ...over,
});

describe("live notifier: reception", () => {
  it("emails reception with the approve link when Slack is off", async () => {
    const { sent, notifier } = setup();
    const result = await notifier.receptionApproval(recCtx());
    expect(result.via).toBe("email");
    expect(sent[0]!.to).toBe("desk@example.com");
    expect(sent[0]!.text).toContain("https://app.example.com/approve/33333333-3333-4333-8333-333333333333");
  });

  it("posts to Slack first and records the message ts", async () => {
    const slackFetch = vi.fn().mockResolvedValue({ json: async () => ({ ok: true, ts: "55.5" }) }) as unknown as typeof fetch;
    const { sent, notifier } = setup({ withSlack: true, slackFetch });
    const result = await notifier.receptionApproval(recCtx({ slackEnabled: true }));
    expect(result).toEqual({ via: "slack", slackMessageTs: "55.5" });
    expect(sent).toHaveLength(1); // the email still goes out as a backup
  });

  it("falls back to email when Slack fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const slackFetch = vi.fn().mockResolvedValue({ json: async () => ({ ok: false, error: "x" }) }) as unknown as typeof fetch;
    const { notifier } = setup({ withSlack: true, slackFetch });
    expect((await notifier.receptionApproval(recCtx({ slackEnabled: true }))).via).toBe("email");
    spy.mockRestore();
  });

  it("reports via null when nothing could be sent", async () => {
    const { notifier } = setup({ fail: true });
    expect((await notifier.receptionApproval(recCtx())).via).toBeNull();
  });

  it("closes the Slack message after approval", async () => {
    const slackFetch = vi.fn().mockResolvedValue({ json: async () => ({ ok: true }) });
    const { notifier } = setup({ withSlack: true, slackFetch: slackFetch as unknown as typeof fetch });
    await notifier.approvalResolved!({ clinic, slackMessageTs: "55.5", text: "✅ Approved by Sam", kind: "approved" });
    expect(slackFetch.mock.calls[0]![0]).toBe("https://slack.com/api/chat.update");
    // no ts -> nothing to update
    await notifier.approvalResolved!({ clinic, slackMessageTs: null, text: "x", kind: "approved" });
    expect(slackFetch).toHaveBeenCalledTimes(1);
  });
});

const confCtx = (over: Partial<ConfirmationContext> = {}): ConfirmationContext => ({
  clinic, slot, patient, doctorEmail: "ali@example.com", cancelledPatientName: "Tom Lee", pipelineId: "pl1", price: 120, shadowMode: false, ...over,
});

describe("live notifier: confirmation and expiry", () => {
  it("emails patient, and the doctor with reception copied", async () => {
    const { sent, notifier } = setup();
    const summary = await notifier.confirmation(confCtx());
    expect(sent.map((m) => m.to)).toEqual(["sarah@example.com", "ali@example.com"]);
    expect(sent[1]!.cc).toBe("desk@example.com");
    expect(summary).toBe("Confirmation email — patient: sent, doctor: sent, reception: sent.");
  });

  it("sends to reception alone when the doctor has no email", async () => {
    const { sent, notifier } = setup();
    const summary = await notifier.confirmation(confCtx({ doctorEmail: null }));
    expect(sent.map((m) => m.to)).toEqual(["sarah@example.com", "desk@example.com"]);
    expect(summary).toContain("doctor: not sent (no address)");
    expect(summary).toContain("reception: sent");
  });

  it("shadow mode sends every confirmation to the test inbox", async () => {
    const { sent, notifier } = setup();
    const summary = await notifier.confirmation(confCtx({ shadowMode: true }));
    expect(new Set(sent.map((m) => m.to))).toEqual(new Set(["test@operator.com"]));
    expect(sent.every((m) => m.cc === undefined)).toBe(true);
    expect(summary).toContain("shadow mode");
  });

  it("alerts reception when a slot expires, and stays quiet with no reception email", async () => {
    const a = setup();
    await a.notifier.slotExpired({ clinic, slot, pipelineId: "pl1", reason: "nobody accepted", offeredCount: 2 });
    expect(a.sent[0]).toMatchObject({ to: "desk@example.com", subject: "Slot still unfilled — manual follow-up needed" });
    const b = setup();
    await b.notifier.slotExpired({ clinic: { ...clinic, contactEmail: null }, slot, pipelineId: "pl1", reason: "x", offeredCount: 0 });
    expect(b.sent).toHaveLength(0);
  });
});

describe("live notifier: SMS", () => {
  function withSms(opts: { fail?: boolean } = {}) {
    const texts: { to: string; body: string }[] = [];
    const sms = {
      async send(i: { to: string; body: string }) {
        texts.push({ to: i.to, body: i.body });
        return !opts.fail;
      },
    };
    const store = memoryDb({});
    const mailer: Mailer = { async send() { return { ok: true, id: "m" }; } };
    const notifier = createLiveNotifier({ db: store.db, appUrl: "https://app.example.com", mailer, sms, shadow: { email: "test@operator.com", phone: "+447700900999" } });
    return { texts, notifier };
  }

  it("advertises email and sms", () => {
    expect(withSms().notifier.channels).toEqual(["email", "sms"]);
  });

  it("sends the short-link offer text", async () => {
    const { texts, notifier } = withSms();
    expect(await notifier.offerOut(offerCtx({ channels: ["sms"] }))).toEqual(["sms"]);
    expect(texts[0]!.to).toBe("+447700900001");
    expect(texts[0]!.body).toContain("https://app.example.com/c/tok-1");
    expect(texts[0]!.body).toContain("reply YES/NO");
  });

  it("sends both channels when both are wanted", async () => {
    const { notifier } = withSms();
    expect(await notifier.offerOut(offerCtx({ channels: ["email", "sms"] }))).toEqual(["email", "sms"]);
  });

  it("shadow mode texts the test phone with a TEST prefix", async () => {
    const { texts, notifier } = withSms();
    await notifier.offerOut(offerCtx({ channels: ["sms"], shadowMode: true }));
    expect(texts[0]!.to).toBe("+447700900999");
    expect(texts[0]!.body.startsWith("[TEST for Sarah Khan] ")).toBe(true);
  });

  it("reports nothing when the text fails", async () => {
    const { notifier } = withSms({ fail: true });
    expect(await notifier.offerOut(offerCtx({ channels: ["sms"] }))).toEqual([]);
  });

  it("texts the booking confirmation unless the patient opted out", async () => {
    const a = withSms();
    const summary = await a.notifier.confirmation(confCtx());
    expect(a.texts[0]!.body).toContain("Confirmed: Tue 27 Oct 14:30 at Smile Dentals");
    expect(summary).toContain("sms: sent");
    const b = withSms();
    await b.notifier.confirmation(confCtx({ patient: { ...patient, smsOptOut: true } }));
    expect(b.texts).toHaveLength(0);
  });
});
