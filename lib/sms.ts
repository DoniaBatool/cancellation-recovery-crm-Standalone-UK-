import twilio from "twilio";
import type { Env } from "@/lib/env";
import type { Db } from "@/lib/pipeline";

// SMS sending through Twilio. Source: SYSTEM_BUILD_GUIDE.md §7 E4.
// `send` never throws and always writes a `messages` row, so the audit trail shows what happened.

export type TwilioConfig = NonNullable<Env["twilio"]>;

/** The part of the Twilio client that we use. Tests pass a fake. */
export type TwilioLike = {
  messages: { create(params: Record<string, unknown>): Promise<{ sid: string; status?: string }> };
};

export type SendSmsInput = {
  to: string;
  body: string;
  clinicId: string;
  pipelineId?: string | null;
  offerId?: string | null;
  patientId?: string | null;
};

export interface SmsSender {
  send(input: SendSmsInput): Promise<boolean>;
}

export function createSmsSender(config: TwilioConfig, db: Db, appUrl: string, client?: TwilioLike): SmsSender {
  const twilioClient: TwilioLike = client ?? (twilio(config.accountSid, config.authToken) as unknown as TwilioLike);
  return {
    async send(input) {
      let sid: string | null = null;
      let status = "failed";
      let error: string | null = null;
      try {
        const params: Record<string, unknown> = {
          to: input.to,
          body: input.body,
          statusCallback: `${appUrl}/api/webhooks/twilio/status`,
        };
        if (config.messagingServiceSid) params.messagingServiceSid = config.messagingServiceSid;
        else if (config.smsFrom) params.from = config.smsFrom;
        const message = await twilioClient.messages.create(params);
        sid = message.sid;
        status = message.status ?? "queued";
      } catch (e) {
        // Log the error text only, never the number or the body.
        error = e instanceof Error ? e.message : "Unknown SMS error";
        console.error("SMS send failed:", error);
      }
      try {
        await db.from("messages").insert({
          clinic_id: input.clinicId,
          pipeline_id: input.pipelineId ?? null,
          offer_id: input.offerId ?? null,
          waitlist_patient_id: input.patientId ?? null,
          channel: "sms",
          direction: "out",
          to_or_from: input.to,
          body: input.body,
          provider_id: sid,
          status,
          error,
        });
      } catch (e) {
        console.error("Could not log SMS:", e instanceof Error ? e.message : e);
      }
      return error === null;
    },
  };
}

export function getSmsSender(config: Env["twilio"], db: Db, appUrl: string): SmsSender | null {
  return config ? createSmsSender(config, db, appUrl) : null;
}

/** Verify X-Twilio-Signature against the exact public URL configured in Twilio. */
export function verifyTwilioSignature(input: {
  authToken: string;
  signature: string | null;
  url: string;
  params: Record<string, string>;
}): boolean {
  if (!input.signature) return false;
  try {
    return twilio.validateRequest(input.authToken, input.signature, input.url, input.params);
  } catch {
    return false;
  }
}

/** Escape text for a TwiML <Message>. */
export function twiml(message: string | null): string {
  if (!message) return '<?xml version="1.0" encoding="UTF-8"?><Response/>';
  const safe = message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`;
}
