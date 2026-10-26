import { z } from "zod";

// Environment validation. Source: SYSTEM_BUILD_GUIDE.md §12.
//
// - Required server vars: throw one readable error that lists EVERY missing key.
// - Email, Dentally, Twilio, Slack groups: `null` when not configured, so those
//   features skip gracefully.
// - NEXT_PUBLIC_* vars are read literally (process.env.NEXT_PUBLIC_X) so Next can inline them.

const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optional = <T extends z.ZodType>(schema: T) => z.preprocess(blankToUndefined, schema.optional());

const rawSchema = z.object({
  // Required
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1),
  CRON_SECRET: z.string().min(32),

  // App
  NEXT_PUBLIC_APP_URL: optional(z.url()),

  // Email (Brevo SMTP)
  SMTP_HOST: optional(z.string().min(1)),
  SMTP_PORT: optional(z.coerce.number().int().positive()),
  SMTP_USER: optional(z.string().min(1)),
  SMTP_PASS: optional(z.string().min(1)),
  SMTP_FROM: optional(z.email()),
  SMTP_FROM_NAME: optional(z.string().min(1)),

  // Dentally
  DENTALLY_API_BASE_URL: optional(z.url()),
  DENTALLY_API_TOKEN: optional(z.string().min(1)),
  DENTALLY_WEBHOOK_SECRET: optional(z.string().min(16)),

  // Twilio
  TWILIO_ACCOUNT_SID: optional(z.string().min(1)),
  TWILIO_AUTH_TOKEN: optional(z.string().min(1)),
  TWILIO_MESSAGING_SERVICE_SID: optional(z.string().min(1)),
  TWILIO_SMS_FROM: optional(z.string().min(1)),
  TWILIO_WHATSAPP_FROM: optional(z.string().min(1)),

  // Slack (optional)
  SLACK_BOT_TOKEN: optional(z.string().min(1)),
  SLACK_SIGNING_SECRET: optional(z.string().min(1)),
  SLACK_CHANNEL_ID: optional(z.string().min(1)),

  // Engine / ops
  OPERATOR_ALERT_EMAIL: optional(z.email()),
  SHADOW_TEST_PHONE: optional(z.string().min(1)),
  SHADOW_TEST_EMAIL: optional(z.email()),
  EXTERNAL_API_KEY: optional(z.string().min(32)),
});

export type Env = {
  appUrl: string;
  supabase: { url: string; publishableKey: string; secretKey: string };
  cronSecret: string;
  email: {
    host: string;
    port: number;
    user: string;
    pass: string;
    from: string;
    fromName: string | null;
  } | null;
  dentally: { baseUrl: string; token: string; webhookSecret: string | null } | null;
  /** Webhook secret is needed even before the API token exists, so it is kept separately. */
  dentallyWebhookSecret: string | null;
  twilio: {
    accountSid: string;
    authToken: string;
    messagingServiceSid: string | null;
    smsFrom: string | null;
    whatsappFrom: string | null;
  } | null;
  slack: { botToken: string; signingSecret: string; channelId: string } | null;
  operatorAlertEmail: string | null;
  shadow: { phone: string | null; email: string | null };
  externalApiKey: string | null;
};

export class EnvError extends Error {
  readonly keys: string[];
  constructor(keys: string[]) {
    super(
      `Missing or invalid environment variables: ${keys.join(", ")}. ` +
        "Copy .env.example to .env.local and fill them in.",
    );
    this.name = "EnvError";
    this.keys = keys;
  }
}

type Source = Record<string, string | undefined>;

/** Read process.env, with NEXT_PUBLIC_* read literally so Next can inline them. */
export function readProcessEnv(): Source {
  return {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  };
}

/** Pure: validate a source object. Used by getEnv() and by tests. */
export function loadEnv(source: Source): Env {
  const parsed = rawSchema.safeParse(source);
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "unknown")))];
    throw new EnvError(keys);
  }
  const v = parsed.data;

  const email =
    v.SMTP_HOST && v.SMTP_USER && v.SMTP_PASS && v.SMTP_FROM
      ? {
          host: v.SMTP_HOST,
          port: v.SMTP_PORT ?? 587,
          user: v.SMTP_USER,
          pass: v.SMTP_PASS,
          from: v.SMTP_FROM,
          fromName: v.SMTP_FROM_NAME ?? null,
        }
      : null;

  const dentally =
    v.DENTALLY_API_BASE_URL && v.DENTALLY_API_TOKEN
      ? {
          baseUrl: v.DENTALLY_API_BASE_URL,
          token: v.DENTALLY_API_TOKEN,
          webhookSecret: v.DENTALLY_WEBHOOK_SECRET ?? null,
        }
      : null;

  const twilio =
    v.TWILIO_ACCOUNT_SID &&
    v.TWILIO_AUTH_TOKEN &&
    (v.TWILIO_MESSAGING_SERVICE_SID || v.TWILIO_SMS_FROM)
      ? {
          accountSid: v.TWILIO_ACCOUNT_SID,
          authToken: v.TWILIO_AUTH_TOKEN,
          messagingServiceSid: v.TWILIO_MESSAGING_SERVICE_SID ?? null,
          smsFrom: v.TWILIO_SMS_FROM ?? null,
          whatsappFrom: v.TWILIO_WHATSAPP_FROM ?? null,
        }
      : null;

  const slack =
    v.SLACK_BOT_TOKEN && v.SLACK_SIGNING_SECRET && v.SLACK_CHANNEL_ID
      ? {
          botToken: v.SLACK_BOT_TOKEN,
          signingSecret: v.SLACK_SIGNING_SECRET,
          channelId: v.SLACK_CHANNEL_ID,
        }
      : null;

  return {
    appUrl: (v.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, ""),
    supabase: {
      url: v.NEXT_PUBLIC_SUPABASE_URL,
      publishableKey: v.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      secretKey: v.SUPABASE_SECRET_KEY,
    },
    cronSecret: v.CRON_SECRET,
    email,
    dentally,
    dentallyWebhookSecret: v.DENTALLY_WEBHOOK_SECRET ?? null,
    twilio,
    slack,
    operatorAlertEmail: v.OPERATOR_ALERT_EMAIL ?? null,
    shadow: { phone: v.SHADOW_TEST_PHONE ?? null, email: v.SHADOW_TEST_EMAIL ?? null },
    externalApiKey: v.EXTERNAL_API_KEY ?? null,
  };
}

let cached: Env | null = null;

/** Server-only. Validates the full environment once, then caches it. */
export function getEnv(): Env {
  if (!cached) cached = loadEnv(readProcessEnv());
  return cached;
}

// ---------------------------------------------------------------------------
// Smaller accessors that do NOT need the whole environment
// (the proxy and the browser only need the public Supabase settings).
// ---------------------------------------------------------------------------

export function loadSupabasePublicConfig(source: Source): { url: string; publishableKey: string } {
  const parsed = z
    .object({
      NEXT_PUBLIC_SUPABASE_URL: z.url(),
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
    })
    .safeParse(source);
  if (!parsed.success) {
    const keys = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? "unknown")))];
    throw new EnvError(keys);
  }
  return {
    url: parsed.data.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: parsed.data.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  };
}

export function getSupabasePublicConfig(): { url: string; publishableKey: string } {
  return loadSupabasePublicConfig({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}

/** Public app URL without trailing slash. Falls back to localhost for local dev. */
export function getAppUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL;
  return (raw && raw.trim() !== "" ? raw : "http://localhost:3000").replace(/\/+$/, "");
}
