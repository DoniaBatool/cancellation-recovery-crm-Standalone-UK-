import { describe, expect, it } from "vitest";
import { EnvError, loadEnv, loadSupabasePublicConfig } from "@/lib/env";

const LONG = "x".repeat(40);
const required = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "pk",
  SUPABASE_SECRET_KEY: "sk",
  CRON_SECRET: LONG,
};

describe("loadEnv", () => {
  it("accepts the required vars and leaves optional groups null", () => {
    const env = loadEnv(required);
    expect(env.supabase).toEqual({ url: "https://abc.supabase.co", publishableKey: "pk", secretKey: "sk" });
    expect(env.email).toBeNull();
    expect(env.dentally).toBeNull();
    expect(env.twilio).toBeNull();
    expect(env.slack).toBeNull();
    expect(env.externalApiKey).toBeNull();
    expect(env.appUrl).toBe("http://localhost:3000");
  });

  it("lists EVERY missing or invalid key in one error", () => {
    try {
      loadEnv({ NEXT_PUBLIC_SUPABASE_URL: "nope", CRON_SECRET: "short" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(EnvError);
      expect((err as EnvError).keys.sort()).toEqual(
        ["CRON_SECRET", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY"].sort(),
      );
      expect((err as Error).message).toContain(".env.example");
    }
  });

  it("never puts values in the error message", () => {
    try {
      loadEnv({ ...required, CRON_SECRET: "tooshort-secret-value" });
    } catch (err) {
      expect((err as Error).message).not.toContain("tooshort-secret-value");
    }
  });

  it("treats blank optional vars as not set", () => {
    const env = loadEnv({ ...required, SMTP_HOST: "", SMTP_PORT: "  ", EXTERNAL_API_KEY: "", NEXT_PUBLIC_APP_URL: "" });
    expect(env.email).toBeNull();
    expect(env.externalApiKey).toBeNull();
    expect(env.appUrl).toBe("http://localhost:3000");
  });

  it("builds the email group only when it is complete, with port 587 by default", () => {
    const partial = loadEnv({ ...required, SMTP_HOST: "smtp.example.com", SMTP_USER: "u" });
    expect(partial.email).toBeNull();
    const full = loadEnv({
      ...required,
      SMTP_HOST: "smtp.example.com",
      SMTP_USER: "u",
      SMTP_PASS: "p",
      SMTP_FROM: "hello@clinic.co.uk",
      SMTP_FROM_NAME: "Smile Dental",
    });
    expect(full.email).toEqual({
      host: "smtp.example.com",
      port: 587,
      user: "u",
      pass: "p",
      from: "hello@clinic.co.uk",
      fromName: "Smile Dental",
    });
    expect(loadEnv({ ...required, SMTP_HOST: "h", SMTP_USER: "u", SMTP_PASS: "p", SMTP_FROM: "a@b.co", SMTP_PORT: "465" }).email?.port).toBe(465);
  });

  it("rejects a bad SMTP_FROM, a non-numeric port and a short Dentally webhook secret", () => {
    for (const bad of [{ SMTP_FROM: "nope" }, { SMTP_PORT: "abc" }, { DENTALLY_WEBHOOK_SECRET: "short" }]) {
      expect(() => loadEnv({ ...required, ...bad })).toThrow(EnvError);
    }
  });

  it("builds the Dentally group and keeps the webhook secret separately", () => {
    const env = loadEnv({
      ...required,
      DENTALLY_API_BASE_URL: "https://api.dentally.co",
      DENTALLY_API_TOKEN: "t",
      DENTALLY_WEBHOOK_SECRET: "a-long-webhook-secret",
    });
    expect(env.dentally).toEqual({ baseUrl: "https://api.dentally.co", token: "t", webhookSecret: "a-long-webhook-secret" });
    const onlySecret = loadEnv({ ...required, DENTALLY_WEBHOOK_SECRET: "a-long-webhook-secret" });
    expect(onlySecret.dentally).toBeNull();
    expect(onlySecret.dentallyWebhookSecret).toBe("a-long-webhook-secret");
  });

  it("needs a sender (messaging service or from number) for Twilio", () => {
    const base = { ...required, TWILIO_ACCOUNT_SID: "AC1", TWILIO_AUTH_TOKEN: "t" };
    expect(loadEnv(base).twilio).toBeNull();
    expect(loadEnv({ ...base, TWILIO_SMS_FROM: "+447700900000" }).twilio?.smsFrom).toBe("+447700900000");
    expect(loadEnv({ ...base, TWILIO_MESSAGING_SERVICE_SID: "MG1" }).twilio?.messagingServiceSid).toBe("MG1");
  });

  it("requires EXTERNAL_API_KEY to be at least 32 characters when present", () => {
    expect(() => loadEnv({ ...required, EXTERNAL_API_KEY: "short" })).toThrow(EnvError);
    expect(loadEnv({ ...required, EXTERNAL_API_KEY: LONG }).externalApiKey).toBe(LONG);
  });

  it("strips trailing slashes from the app URL", () => {
    expect(loadEnv({ ...required, NEXT_PUBLIC_APP_URL: "https://recovery.clinic.co.uk//" }).appUrl).toBe(
      "https://recovery.clinic.co.uk",
    );
  });

  it("builds the Slack group only when complete", () => {
    expect(loadEnv({ ...required, SLACK_BOT_TOKEN: "b" }).slack).toBeNull();
    expect(
      loadEnv({ ...required, SLACK_BOT_TOKEN: "b", SLACK_SIGNING_SECRET: "s", SLACK_CHANNEL_ID: "C1" }).slack,
    ).toEqual({ botToken: "b", signingSecret: "s", channelId: "C1" });
  });
});

describe("loadSupabasePublicConfig", () => {
  it("only needs the two public vars", () => {
    expect(
      loadSupabasePublicConfig({
        NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "pk",
      }),
    ).toEqual({ url: "https://abc.supabase.co", publishableKey: "pk" });
  });

  it("throws an EnvError naming what is missing", () => {
    expect(() => loadSupabasePublicConfig({})).toThrow(EnvError);
    try {
      loadSupabasePublicConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co" });
    } catch (err) {
      expect((err as EnvError).keys).toEqual(["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]);
    }
  });
});
