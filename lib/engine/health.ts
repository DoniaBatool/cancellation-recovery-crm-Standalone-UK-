import type { Mailer } from "@/lib/email";
import { operatorAlertEmail } from "@/lib/email-templates";
import { nowOf, type EngineDeps } from "@/lib/engine/context";
import { getState, setState } from "@/lib/engine/state";
import { weekdayInZone } from "@/lib/waitlist-matching";

// Monitoring. Source: SYSTEM_BUILD_GUIDE.md §7 E10.
// GET /api/health returns the snapshot. The hourly health-check cron emails OPERATOR_ALERT_EMAIL when
// something is wrong: a silent webhook, a failing poller, many failed texts, or a cron that has stopped.

export type HealthSnapshot = {
  dbOk: boolean;
  clinicId: string | null;
  clinicName: string;
  timeZone: string;
  engineEnabled: boolean | null;
  shadowMode: boolean | null;
  lastWebhookAt: string | null;
  lastPollAt: string | null;
  lastPollChangesAt: string | null;
  pollFailures: number;
  pendingOffers: number;
  /** Pending offers whose expiry passed more than 10 minutes ago (the tick cron is not running). */
  stuckOffers: number;
  smsLastHour: number;
  smsFailedLastHour: number;
  /** True when Dentally is configured for this deployment. */
  dentally: boolean;
};

const HOUR = 3_600_000;
export const MIN_SMS_SAMPLE = 5;

export async function collectHealth(deps: EngineDeps, dentally: boolean): Promise<HealthSnapshot> {
  const now = nowOf(deps);
  const snapshot: HealthSnapshot = {
    dbOk: false, clinicId: null, clinicName: "SlotRefill", timeZone: "Europe/London", engineEnabled: null, shadowMode: null,
    lastWebhookAt: null, lastPollAt: null, lastPollChangesAt: null, pollFailures: 0,
    pendingOffers: 0, stuckOffers: 0, smsLastHour: 0, smsFailedLastHour: 0, dentally,
  };

  const { data: clinic, error } = await deps.db.from("clinics").select("id, name, timezone").eq("is_active", true).order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (error) return snapshot;
  snapshot.dbOk = true;
  if (!clinic) return snapshot;
  snapshot.clinicId = clinic.id;
  snapshot.clinicName = clinic.name;
  snapshot.timeZone = clinic.timezone;

  const { data: config } = await deps.db.from("clinic_config").select("engine_enabled, shadow_mode").eq("clinic_id", clinic.id).maybeSingle();
  snapshot.engineEnabled = config?.engine_enabled ?? null;
  snapshot.shadowMode = config?.shadow_mode ?? null;

  snapshot.lastWebhookAt = await getState<string>(deps.db, clinic.id, "last_webhook_at");
  snapshot.lastPollAt = await getState<string>(deps.db, clinic.id, "last_poll_at");
  snapshot.lastPollChangesAt = await getState<string>(deps.db, clinic.id, "last_poll_changes_at");
  snapshot.pollFailures = (await getState<number>(deps.db, clinic.id, "poll_failures")) ?? 0;

  const { data: pending } = await deps.db.from("waitlist_offers").select("offer_expires_at").eq("response", "pending");
  for (const o of pending ?? []) {
    const exp = o.offer_expires_at ? new Date(o.offer_expires_at).getTime() : null;
    if (exp === null || exp >= now.getTime()) snapshot.pendingOffers += 1;
    else if (now.getTime() - exp > 10 * 60_000) snapshot.stuckOffers += 1;
  }

  const { data: sms } = await deps.db
    .from("messages")
    .select("status, created_at")
    .eq("clinic_id", clinic.id)
    .eq("channel", "sms")
    .eq("direction", "out")
    .gte("created_at", new Date(now.getTime() - HOUR).toISOString());
  snapshot.smsLastHour = sms?.length ?? 0;
  snapshot.smsFailedLastHour = (sms ?? []).filter((m) => m.status === "failed" || m.status === "undelivered").length;
  return snapshot;
}

export type Alert = { kind: "webhook_silent" | "poll_failing" | "sms_failing" | "offers_stuck"; message: string };

const isWeekday = (now: Date, tz: string) => {
  const day = weekdayInZone(now, tz);
  return day !== "Saturday" && day !== "Sunday";
};

/** Pure: which alerts apply to this snapshot. */
export function evaluateAlerts(s: HealthSnapshot, now: Date): Alert[] {
  const alerts: Alert[] = [];

  if (s.dentally && isWeekday(now, s.timeZone)) {
    const quietForDay = !s.lastWebhookAt || now.getTime() - new Date(s.lastWebhookAt).getTime() > 24 * HOUR;
    const pollerSawChanges = s.lastPollChangesAt !== null && now.getTime() - new Date(s.lastPollChangesAt).getTime() <= 24 * HOUR;
    if (quietForDay && pollerSawChanges) {
      alerts.push({ kind: "webhook_silent", message: "No Dentally webhook for 24 hours, but the poller is finding changes. The webhook was probably deactivated: re-enable it in Dentally (Settings, Developer, Webhooks)." });
    }
  }
  if (s.dentally && s.pollFailures >= 3) {
    alerts.push({ kind: "poll_failing", message: `The Dentally poller has failed ${s.pollFailures} times in a row. Check the Dentally token and connection.` });
  }
  if (s.smsLastHour >= MIN_SMS_SAMPLE && s.smsFailedLastHour / s.smsLastHour > 0.2) {
    alerts.push({ kind: "sms_failing", message: `${s.smsFailedLastHour} of ${s.smsLastHour} texts failed in the last hour. Check the Twilio account and number.` });
  }
  if (s.stuckOffers > 0) {
    alerts.push({ kind: "offers_stuck", message: `${s.stuckOffers} offer${s.stuckOffers === 1 ? " is" : "s are"} still pending more than 10 minutes after expiry. The per-minute cron is probably not running.` });
  }
  return alerts;
}

const REALERT_MS = 6 * HOUR;

/** Email the operator about new alerts (each kind at most once every 6 hours). Returns what was sent. */
export async function runHealthCheck(
  deps: EngineDeps,
  opts: { dentally: boolean; mailer: Mailer | null; operatorEmail: string | null; appUrl: string },
): Promise<{ alerts: Alert[]; emailed: Alert[] }> {
  const now = nowOf(deps);
  const snapshot = await collectHealth(deps, opts.dentally);
  const alerts = snapshot.dbOk ? evaluateAlerts(snapshot, now) : [];
  if (!snapshot.clinicId) return { alerts, emailed: [] };

  const fresh: Alert[] = [];
  for (const alert of alerts) {
    const last = await getState<string>(deps.db, snapshot.clinicId, `alerted:${alert.kind}`);
    if (!last || now.getTime() - new Date(last).getTime() >= REALERT_MS) fresh.push(alert);
  }
  if (fresh.length === 0 || !opts.mailer || !opts.operatorEmail) return { alerts, emailed: [] };

  const mail = operatorAlertEmail({ clinicName: snapshot.clinicName, alerts: fresh.map((a) => a.message), link: `${opts.appUrl}/crm` });
  const result = await opts.mailer.send({ to: opts.operatorEmail, ...mail });
  if (!result.ok) return { alerts, emailed: [] };
  for (const alert of fresh) await setState(deps.db, snapshot.clinicId, `alerted:${alert.kind}`, now.toISOString());
  return { alerts, emailed: fresh };
}
