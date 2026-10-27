import type { EngineDeps } from "@/lib/engine/context";
import type { Notifier } from "@/lib/engine/notifier";
import { createDentallyClient, type DentallyClient } from "@/lib/dentally/client";
import { getEnv } from "@/lib/env";
import { getSmsSender } from "@/lib/sms";
import { getMailer } from "@/lib/email";
import { createLiveNotifier } from "@/lib/engine/live-notifier";
import type { Db } from "@/lib/pipeline";
import { getAdminClient } from "@/lib/supabase/admin";

// Wires the engine to the real database and the real notifier. Server only.

/**
 * Used when email is not configured: offers are created (so the card moves and the offer link works)
 * but nothing is emailed. Each offer gets a history note so reception knows to share the link by hand.
 */
export const holdNotifier: Notifier = {
  channels: ["email"],
  async offerOut() {
    return [];
  },
  async receptionApproval() {
    return { via: null };
  },
  async confirmation() {
    return "Confirmation emails are not set up yet, so nothing was sent.";
  },
  async slotExpired() {},
};

/**
 * The real notifier when Brevo email or Twilio SMS is configured, otherwise the hold notifier.
 * Slack and SMS are added when their settings exist.
 */
export function getNotifier(db: Db): Notifier {
  let env: ReturnType<typeof getEnv>;
  try {
    env = getEnv();
  } catch {
    return holdNotifier;
  }
  const mailer = getMailer(env.email);
  const sms = getSmsSender(env.twilio, db, env.appUrl);
  if (!mailer && !sms) return holdNotifier;
  return createLiveNotifier({ db, appUrl: env.appUrl, mailer, sms, slack: env.slack, shadow: env.shadow });
}

/** Engine dependencies for a server action or route, or null when the server key is missing. */
export function getEngineDeps(): EngineDeps | null {
  try {
    const db = getAdminClient();
    return { db, notifier: getNotifier(db) };
  } catch {
    return null;
  }
}

/** Read-only Dentally client, or null when Dentally is not configured. */
export function getDentallyClient(): DentallyClient | null {
  try {
    const env = getEnv();
    if (!env.dentally) return null;
    return createDentallyClient({
      baseUrl: env.dentally.baseUrl,
      token: env.dentally.token,
      userAgent: `SlotRefill/1.0 (${env.operatorAlertEmail ?? "support"})`,
    });
  } catch {
    return null;
  }
}
