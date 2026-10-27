import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  appEnvVars,
  authConfigPayload,
  buildPlan,
  cronJobsFor,
  cronSql,
  migrationRunSql,
  parseEnv,
  parseMigrationFile,
  pendingMigrations,
  secretsToGenerate,
  setEnvValue,
  validateClinicEnv,
  vercelVarType,
  webhookUrls,
  toVercelEnvFile,
} from "../scripts/lib/clinic-env.mjs";

const root = path.resolve(import.meta.dirname, "..");

const good = {
  CLINIC_NAME: "Smile Dental",
  CLINIC_SLUG: "smile-dental",
  CLINIC_EMAIL: "reception@smile.co.uk",
  MANAGER_EMAIL: "manager@smile.co.uk",
  APP_URL: "https://recovery.smile.co.uk",
  SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
  SUPABASE_ACCESS_TOKEN: "sbp_abc",
  SMTP_HOST: "smtp-relay.brevo.com",
  SMTP_USER: "u",
  SMTP_PASS: "p",
  SMTP_FROM: "appointments@smile.co.uk",
};

describe("parseEnv / setEnvValue", () => {
  it("reads values, quotes and comments", () => {
    const v = parseEnv('A=1\n# comment\nB="two words"\nC=three   # note\nD=   # only a comment\nE=\n  F = spaced \n');
    expect(v).toMatchObject({ A: "1", B: "two words", C: "three", D: "", E: "", F: "spaced" });
  });

  it("parses the example file with no leftover comment text in values", () => {
    const v = parseEnv(readFileSync(path.join(root, "clinics/clinic.example.env"), "utf8"));
    expect(v.CLINIC_SLUG).toBe("smile-dental");
    expect(v.CRON_SECRET).toBe("");
    expect(v.DENTALLY_WEBHOOK_SECRET).toBe("");
    expect(v.SMTP_HOST).toBe("smtp-relay.brevo.com");
  });

  it("replaces an existing key and keeps the other lines", () => {
    expect(setEnvValue("A=1 # x\nB=2\n", "A", "9")).toBe("A=9\nB=2\n");
  });

  it("appends a missing key", () => {
    expect(setEnvValue("A=1\n", "C", "3")).toBe("A=1\nC=3\n");
  });
});

describe("validateClinicEnv", () => {
  it("accepts a complete file", () => {
    expect(validateClinicEnv(good).errors).toEqual([]);
  });

  it("lists every missing required key", () => {
    const { errors } = validateClinicEnv({});
    for (const key of ["CLINIC_NAME", "APP_URL", "SUPABASE_PROJECT_REF", "SUPABASE_ACCESS_TOKEN", "SMTP_PASS"]) {
      expect(errors.some((e) => e.startsWith(key))).toBe(true);
    }
  });

  it("rejects bad slug, project ref, token, URL and emails", () => {
    const { errors } = validateClinicEnv({
      ...good,
      CLINIC_SLUG: "Smile Dental",
      SUPABASE_PROJECT_REF: "short",
      SUPABASE_ACCESS_TOKEN: "nope",
      APP_URL: "http://recovery.smile.co.uk/app",
      MANAGER_EMAIL: "not-an-email",
    });
    expect(errors.join("\n")).toMatch(/CLINIC_SLUG/);
    expect(errors.join("\n")).toMatch(/SUPABASE_PROJECT_REF/);
    expect(errors.join("\n")).toMatch(/sbp_/);
    expect(errors.join("\n")).toMatch(/https/);
    expect(errors.join("\n")).toMatch(/no path/);
    expect(errors.join("\n")).toMatch(/MANAGER_EMAIL/);
  });

  it("allows http for localhost", () => {
    expect(validateClinicEnv({ ...good, APP_URL: "http://localhost:3004" }).errors).toEqual([]);
  });

  it("rejects short secrets that were typed in", () => {
    const { errors } = validateClinicEnv({ ...good, CRON_SECRET: "short", DENTALLY_WEBHOOK_SECRET: "short" });
    expect(errors.length).toBe(2);
  });

  it("warns about half-filled optional groups and missing ops values", () => {
    const { warnings, errors } = validateClinicEnv({ ...good, SLACK_BOT_TOKEN: "x", TWILIO_ACCOUNT_SID: "AC1", DENTALLY_API_TOKEN: "t" });
    expect(errors).toEqual([]);
    const text = warnings.join("\n");
    expect(text).toMatch(/Slack is only partly/);
    expect(text).toMatch(/Twilio/);
    expect(text).toMatch(/Dentally is only partly/);
    expect(text).toMatch(/OPERATOR_ALERT_EMAIL/);
    expect(text).toMatch(/SHADOW_TEST/);
    expect(text).toMatch(/VERCEL/);
  });
});

describe("secrets and app variables", () => {
  it("generates only what is missing and never replaces valid values", () => {
    const gen = () => "g".repeat(48);
    expect(Object.keys(secretsToGenerate({}, gen)).sort()).toEqual(["CRON_SECRET", "DENTALLY_WEBHOOK_SECRET"]);
    expect(secretsToGenerate({ CRON_SECRET: "c".repeat(40), DENTALLY_WEBHOOK_SECRET: "w".repeat(20) }, gen)).toEqual({});
    expect(Object.keys(secretsToGenerate({ CRON_SECRET: "c".repeat(40) }, gen))).toEqual(["DENTALLY_WEBHOOK_SECRET"]);
  });

  it("builds the app environment with only non-empty values", () => {
    const vars = appEnvVars(
      { ...good, APP_URL: "https://recovery.smile.co.uk/", CRON_SECRET: "c".repeat(40), SLACK_BOT_TOKEN: "" },
      { publishableKey: "pk", secretKey: "sk" },
    );
    expect(vars.NEXT_PUBLIC_APP_URL).toBe("https://recovery.smile.co.uk");
    expect(vars.NEXT_PUBLIC_SUPABASE_URL).toBe("https://abcdefghijklmnopqrst.supabase.co");
    expect(vars.SUPABASE_SECRET_KEY).toBe("sk");
    expect(vars.CRON_SECRET).toBe("c".repeat(40));
    expect("SLACK_BOT_TOKEN" in vars).toBe(false);
    // clinic-file-only keys are not pushed
    expect("SUPABASE_ACCESS_TOKEN" in vars).toBe(false);
    expect("VERCEL_TOKEN" in vars).toBe(false);
    expect("MANAGER_EMAIL" in vars).toBe(false);
  });

  it("every pushed variable is a name the app reads (.env.example)", () => {
    const example = readFileSync(path.join(root, ".env.example"), "utf8");
    const known = new Set(Object.keys(parseEnv(example)));
    const vars = appEnvVars(
      Object.fromEntries(
        [...known, ...Object.keys(good)].map((k) => [k, (good as Record<string, string>)[k] ?? "value-value-value-value-value-12345"]),
      ),
      { publishableKey: "pk", secretKey: "sk" },
    );
    for (const key of Object.keys(vars)) expect(known.has(key)).toBe(true);
  });

  it("marks only NEXT_PUBLIC_ values as plain", () => {
    expect(vercelVarType("NEXT_PUBLIC_APP_URL")).toBe("plain");
    expect(vercelVarType("SUPABASE_SECRET_KEY")).toBe("encrypted");
  });

  it("writes a paste-able file", () => {
    expect(toVercelEnvFile({ A: "1", B: "2" })).toMatch(/^# .*\nA=1\nB=2\n$/);
  });

  it("prints the right webhook addresses", () => {
    const u = webhookUrls({ ...good, DENTALLY_WEBHOOK_SECRET: "s".repeat(20) });
    expect(u.join).toBe("https://recovery.smile.co.uk/join/smile-dental");
    expect(u.dentally).toBe(`https://recovery.smile.co.uk/api/webhooks/dentally/${"s".repeat(20)}`);
    expect(u.twilioInbound).toBe("https://recovery.smile.co.uk/api/webhooks/twilio/inbound");
    expect(u.twilioStatus).toBe("https://recovery.smile.co.uk/api/webhooks/twilio/status");
    expect(u.slackInteractivity).toBe("https://recovery.smile.co.uk/api/webhooks/slack/actions");
  });
});

describe("Auth config", () => {
  it("sets site URL, redirect, SMTP and email templates that use the app's /auth/confirm route", () => {
    const p = authConfigPayload({ ...good, SMTP_PORT: "2525", CLINIC_NAME: "Smile & Co" });
    expect(p.site_url).toBe("https://recovery.smile.co.uk");
    expect(p.uri_allow_list).toBe("https://recovery.smile.co.uk/auth/confirm");
    expect(p.smtp_host).toBe("smtp-relay.brevo.com");
    expect(p.smtp_port).toBe("2525");
    expect(p.smtp_admin_email).toBe("appointments@smile.co.uk");
    expect(p.mailer_templates_invite_content).toContain("/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/set-password");
    expect(p.mailer_templates_recovery_content).toContain("type=recovery");
    expect(p.mailer_templates_invite_content).toContain("Smile &amp; Co");
  });
});

describe("migrations", () => {
  const files = ["20270101000003_c.sql", "20270101000001_a.sql", "20270101000002_b.sql", "README.md"];

  it("parses file names", () => {
    expect(parseMigrationFile("20270101000004_rate_limits.sql")).toEqual({ file: "20270101000004_rate_limits.sql", version: "20270101000004", name: "rate_limits" });
    expect(parseMigrationFile("notes.sql")).toBeNull();
  });

  it("returns every migration in order when none are applied", () => {
    expect(pendingMigrations(files, []).map((m) => m.name)).toEqual(["a", "b", "c"]);
  });

  it("skips what is applied by version or by name", () => {
    const applied = [
      { version: "20270101000001", name: "a" },
      { version: "20261026084915", name: "b" }, // same migration, different timestamp (applied with other tooling)
    ];
    expect(pendingMigrations(files, applied).map((m) => m.name)).toEqual(["c"]);
  });

  it("records the migration in the same request as its SQL", () => {
    const sql = migrationRunSql({ file: "x", version: "20270101000009", name: "it's" }, "create table t();\n");
    expect(sql).toContain("create table t();");
    expect(sql).toContain("insert into supabase_migrations.schema_migrations (version, name) values ('20270101000009', 'it''s')");
  });

  it("the repo's real migrations all have valid names", () => {
    const names = ["20270101000001_schema.sql", "20270101000002_rls.sql", "20270101000003_v21_schema_changes.sql", "20270101000004_rate_limits.sql"];
    expect(pendingMigrations(names, []).length).toBe(4);
  });
});

describe("cron jobs", () => {
  it("schedules dentally-poll only when a Dentally token exists", () => {
    expect(cronJobsFor(good).find((j) => j.name === "dentally-poll")?.enabled).toBe(false);
    expect(cronJobsFor({ ...good, DENTALLY_API_TOKEN: "t" }).find((j) => j.name === "dentally-poll")?.enabled).toBe(true);
  });

  it("points at routes that exist in the app and uses the guide's schedules", () => {
    for (const job of cronJobsFor({ ...good, DENTALLY_API_TOKEN: "t" })) {
      const file = path.join(root, "app", job.path, "route.ts");
      expect(() => readFileSync(file, "utf8")).not.toThrow();
    }
    const byName = Object.fromEntries(cronJobsFor(good).map((j) => [j.name, j.schedule]));
    expect(byName).toMatchObject({ "offers-tick": "* * * * *", "dentally-poll": "*/5 * * * *", "health-check": "0 * * * *" });
  });

  it("builds SQL that reads the secret from Vault and sends a Bearer header", () => {
    const sql = cronSql({ ...good, CRON_SECRET: "c".repeat(40), DENTALLY_API_TOKEN: "t" });
    expect(sql).toContain("create extension if not exists pg_cron");
    expect(sql).toContain("create extension if not exists pg_net");
    expect(sql).toContain("vault.create_secret");
    expect(sql).toContain("vault.update_secret");
    expect(sql).toContain("'Authorization', 'Bearer '");
    expect(sql).toContain("cron.schedule('offers-tick', '* * * * *'");
    expect(sql).toContain("cron.schedule('dentally-poll', '*/5 * * * *'");
    // the secret is only in the vault statements, never inside a job body
    const jobBodies = sql.split("$job$").filter((_, i) => i % 2 === 1).join("");
    expect(jobBodies).not.toContain("c".repeat(40));
  });

  it("unschedules dentally-poll when there is no token, and escapes quotes", () => {
    const sql = cronSql({ ...good, CRON_SECRET: "c'c".repeat(15) });
    expect(sql).toContain("cron.unschedule('dentally-poll')");
    expect(sql).toContain("c''c");
  });
});

describe("plan", () => {
  it("lists nine steps", () => {
    expect(buildPlan(good).length).toBe(9);
  });
});
