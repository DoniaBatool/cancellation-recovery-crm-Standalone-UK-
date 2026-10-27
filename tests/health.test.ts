import { describe, expect, it, vi } from "vitest";
import type { Mail, Mailer } from "@/lib/email";
import { collectHealth, evaluateAlerts, runHealthCheck, type HealthSnapshot } from "@/lib/engine/health";
import { NOW, makeWorld } from "./helpers/engine-world";

const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
const snap = (over: Partial<HealthSnapshot> = {}): HealthSnapshot => ({
  dbOk: true, clinicId: "c1", clinicName: "Smile Dentals", timeZone: "Europe/London", engineEnabled: true, shadowMode: false,
  lastWebhookAt: hoursAgo(1), lastPollAt: hoursAgo(0.1), lastPollChangesAt: hoursAgo(1), pollFailures: 0,
  pendingOffers: 0, stuckOffers: 0, smsLastHour: 0, smsFailedLastHour: 0, dentally: true, ...over,
});
// NOW is Monday 26 Oct 2026.
const SATURDAY = new Date("2026-10-24T12:00:00Z");

describe("evaluateAlerts", () => {
  it("no alerts when all is well", () => {
    expect(evaluateAlerts(snap(), NOW)).toEqual([]);
  });

  it("webhook silent: 24h of quiet on a weekday while the poller found changes", () => {
    const alerts = evaluateAlerts(snap({ lastWebhookAt: hoursAgo(30) }), NOW);
    expect(alerts.map((a) => a.kind)).toEqual(["webhook_silent"]);
    expect(alerts[0]!.message).toContain("re-enable it in Dentally");
    expect(evaluateAlerts(snap({ lastWebhookAt: null }), NOW).map((a) => a.kind)).toEqual(["webhook_silent"]);
  });

  it("webhook quiet is fine at the weekend or when the poller saw nothing", () => {
    expect(evaluateAlerts(snap({ lastWebhookAt: hoursAgo(30) }), SATURDAY)).toEqual([]);
    expect(evaluateAlerts(snap({ lastWebhookAt: hoursAgo(30), lastPollChangesAt: hoursAgo(40) }), NOW)).toEqual([]);
    expect(evaluateAlerts(snap({ lastWebhookAt: hoursAgo(30), lastPollChangesAt: null }), NOW)).toEqual([]);
  });

  it("poller failed 3 times in a row", () => {
    expect(evaluateAlerts(snap({ pollFailures: 2 }), NOW)).toEqual([]);
    expect(evaluateAlerts(snap({ pollFailures: 3 }), NOW).map((a) => a.kind)).toEqual(["poll_failing"]);
  });

  it("SMS failure rate above 20% in the hour (with enough texts to mean something)", () => {
    expect(evaluateAlerts(snap({ smsLastHour: 10, smsFailedLastHour: 2 }), NOW)).toEqual([]); // exactly 20%
    expect(evaluateAlerts(snap({ smsLastHour: 10, smsFailedLastHour: 3 }), NOW).map((a) => a.kind)).toEqual(["sms_failing"]);
    expect(evaluateAlerts(snap({ smsLastHour: 2, smsFailedLastHour: 2 }), NOW)).toEqual([]); // too few to judge
  });

  it("offers stuck past expiry", () => {
    expect(evaluateAlerts(snap({ stuckOffers: 2 }), NOW).map((a) => a.kind)).toEqual(["offers_stuck"]);
  });

  it("Dentally alerts are skipped when Dentally is not used", () => {
    expect(evaluateAlerts(snap({ dentally: false, lastWebhookAt: null, pollFailures: 9 }), NOW)).toEqual([]);
  });
});

describe("collectHealth", () => {
  it("counts pending, stuck and failed texts", async () => {
    const w = makeWorld({
      offers: [
        { id: "o1", pipeline_id: "p1", waitlist_patient_id: "a", response: "pending", offer_expires_at: new Date(NOW.getTime() + 600_000).toISOString() },
        { id: "o2", pipeline_id: "p1", waitlist_patient_id: "b", response: "pending", offer_expires_at: new Date(NOW.getTime() - 15 * 60_000).toISOString() },
        { id: "o3", pipeline_id: "p1", waitlist_patient_id: "c", response: "pending", offer_expires_at: new Date(NOW.getTime() - 2 * 60_000).toISOString() },
        { id: "o4", pipeline_id: "p1", waitlist_patient_id: "c", response: "declined", offer_expires_at: null },
      ],
    });
    w.tables.messages = [
      { clinic_id: "c1", channel: "sms", direction: "out", status: "delivered", created_at: hoursAgo(0.2) },
      { clinic_id: "c1", channel: "sms", direction: "out", status: "failed", created_at: hoursAgo(0.3) },
      { clinic_id: "c1", channel: "sms", direction: "out", status: "failed", created_at: hoursAgo(3) },
      { clinic_id: "c1", channel: "email", direction: "out", status: "sent", created_at: hoursAgo(0.1) },
    ];
    w.tables.engine_state!.push({ clinic_id: "c1", key: "poll_failures", value: 2 });
    const s = await collectHealth(w.deps, true);
    expect(s).toMatchObject({ dbOk: true, clinicName: "Smile Dentals", pendingOffers: 2 - 1 + 0, stuckOffers: 1, smsLastHour: 2, smsFailedLastHour: 1, pollFailures: 2, engineEnabled: true });
  });

  it("reports the database as down when the query fails", async () => {
    const w = makeWorld({});
    w.failOn("clinics", "select");
    expect((await collectHealth(w.deps, false)).dbOk).toBe(false);
  });
});

describe("runHealthCheck", () => {
  function mailer() {
    const sent: Mail[] = [];
    const m: Mailer = { async send(mail) { sent.push(mail); return { ok: true, id: "m" }; } };
    return { sent, m };
  }
  const opts = (m: Mailer | null) => ({ dentally: true, mailer: m, operatorEmail: "ops@example.com", appUrl: "https://app.example.com" });

  it("emails the operator once, then stays quiet for 6 hours", async () => {
    const w = makeWorld({});
    w.tables.engine_state!.push({ clinic_id: "c1", key: "poll_failures", value: 4 });
    const { sent, m } = mailer();
    const first = await runHealthCheck(w.deps, opts(m));
    expect(first.emailed.map((a) => a.kind)).toEqual(["poll_failing"]);
    expect(sent[0]).toMatchObject({ to: "ops@example.com" });
    expect(sent[0]!.subject).toBe("[SlotRefill] Smile Dentals: attention needed");
    expect((await runHealthCheck(w.deps, opts(m))).emailed).toEqual([]);
    expect(sent).toHaveLength(1);
    // 7 hours later it reminds again
    const later = { ...w.deps, now: new Date(NOW.getTime() + 7 * 3_600_000) };
    expect((await runHealthCheck(later, opts(m))).emailed).toHaveLength(1);
  });

  it("sends nothing when all is well, or when there is no operator address or mailer", async () => {
    const ok = makeWorld({});
    const a = mailer();
    expect((await runHealthCheck(ok.deps, opts(a.m))).alerts).toEqual([]);
    expect(a.sent).toHaveLength(0);

    const bad = makeWorld({});
    bad.tables.engine_state!.push({ clinic_id: "c1", key: "poll_failures", value: 4 });
    expect((await runHealthCheck(bad.deps, { ...opts(null) })).emailed).toEqual([]);
    expect((await runHealthCheck(bad.deps, { ...opts(a.m), operatorEmail: null })).emailed).toEqual([]);
  });

  it("a failed email does not mark the alert as sent", async () => {
    const w = makeWorld({});
    w.tables.engine_state!.push({ clinic_id: "c1", key: "poll_failures", value: 4 });
    const failing: Mailer = { send: vi.fn().mockResolvedValue({ ok: false, error: "smtp" }) };
    expect((await runHealthCheck(w.deps, opts(failing))).emailed).toEqual([]);
    const { sent, m } = mailer();
    expect((await runHealthCheck(w.deps, opts(m))).emailed).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });
});
