// Pure helpers for scripts/clinic-setup.mjs (no network, no file writes) so they can be unit tested.
// Source: SYSTEM_BUILD_GUIDE.md §13.

import { randomBytes } from "node:crypto";

export const REQUIRED_KEYS = [
  "CLINIC_NAME",
  "CLINIC_SLUG",
  "CLINIC_EMAIL",
  "MANAGER_EMAIL",
  "APP_URL",
  "SUPABASE_PROJECT_REF",
  "SUPABASE_ACCESS_TOKEN",
  "SMTP_HOST",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_FROM",
];

/** Clinic-file keys that are pushed to the app's environment as-is. */
const PASS_THROUGH_KEYS = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_FROM",
  "SMTP_FROM_NAME",
  "DENTALLY_API_BASE_URL",
  "DENTALLY_API_TOKEN",
  "DENTALLY_WEBHOOK_SECRET",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_MESSAGING_SERVICE_SID",
  "TWILIO_SMS_FROM",
  "TWILIO_WHATSAPP_FROM",
  "SLACK_BOT_TOKEN",
  "SLACK_SIGNING_SECRET",
  "SLACK_CHANNEL_ID",
  "CRON_SECRET",
  "OPERATOR_ALERT_EMAIL",
  "SHADOW_TEST_PHONE",
  "SHADOW_TEST_EMAIL",
  "EXTERNAL_API_KEY",
];

export const CRON_JOBS = [
  { name: "offers-tick", schedule: "* * * * *", path: "/api/cron/offers-tick", needs: null },
  { name: "dentally-poll", schedule: "*/5 * * * *", path: "/api/cron/dentally-poll", needs: "DENTALLY_API_TOKEN" },
  { name: "health-check", schedule: "0 * * * *", path: "/api/cron/health-check", needs: null },
];

// ---------------------------------------------------------------------------
// Env file parsing
// ---------------------------------------------------------------------------

function parseValue(raw) {
  const v = raw.trim();
  if ((v.startsWith('"') && v.endsWith('"') && v.length >= 2) || (v.startsWith("'") && v.endsWith("'") && v.length >= 2)) {
    return v.slice(1, -1);
  }
  // Unquoted: " # comment" (or a value that is only a comment) is dropped.
  const hash = raw.search(/(^|\s)#/);
  return (hash === -1 ? raw : raw.slice(0, hash)).trim();
}

/** Parse KEY=value lines. Comments (#) and blank lines are ignored. */
export function parseEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (!m) continue;
    values[m[1]] = parseValue(m[2]);
  }
  return values;
}

/** Set (or append) KEY=value in env file text, keeping every other line and comment as it was. */
export function setEnvValue(text, key, value) {
  const lines = text.split(/\r?\n/);
  const re = new RegExp(`^\\s*${key}\\s*=`);
  const index = lines.findIndex((l) => re.test(l));
  const line = `${key}=${value}`;
  if (index >= 0) {
    lines[index] = line;
    return lines.join("\n");
  }
  const trimmed = text.replace(/\s+$/, "");
  return `${trimmed}\n${line}\n`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** @returns {{ errors: string[], warnings: string[] }} */
export function validateClinicEnv(v) {
  const errors = [];
  const warnings = [];

  for (const key of REQUIRED_KEYS) if (!v[key]) errors.push(`${key} is missing.`);

  if (v.CLINIC_SLUG && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(v.CLINIC_SLUG)) {
    errors.push("CLINIC_SLUG must be lowercase letters, numbers and single dashes (e.g. smile-dental).");
  }
  for (const key of ["CLINIC_EMAIL", "MANAGER_EMAIL", "SMTP_FROM", "OPERATOR_ALERT_EMAIL", "SHADOW_TEST_EMAIL"]) {
    if (v[key] && !EMAIL.test(v[key])) errors.push(`${key} is not a valid email address.`);
  }
  if (v.APP_URL) {
    try {
      const u = new URL(v.APP_URL);
      if (u.protocol !== "https:" && u.hostname !== "localhost") errors.push("APP_URL must start with https:// (http is only allowed for localhost).");
      if (u.pathname !== "/" || u.search || u.hash) errors.push("APP_URL must be just the address, with no path (e.g. https://recovery.clinic.co.uk).");
    } catch {
      errors.push("APP_URL is not a valid URL.");
    }
  }
  if (v.SUPABASE_PROJECT_REF && !/^[a-z]{20}$/.test(v.SUPABASE_PROJECT_REF)) {
    errors.push("SUPABASE_PROJECT_REF must be exactly 20 lowercase letters (the id in your Supabase project URL).");
  }
  if (v.SUPABASE_ACCESS_TOKEN && !v.SUPABASE_ACCESS_TOKEN.startsWith("sbp_")) {
    errors.push("SUPABASE_ACCESS_TOKEN must start with sbp_ (create it in Supabase → Account → Access Tokens).");
  }
  if (v.SMTP_PORT && !/^\d+$/.test(v.SMTP_PORT)) errors.push("SMTP_PORT must be a number.");
  if (v.CRON_SECRET && v.CRON_SECRET.length < 32) errors.push("CRON_SECRET must be at least 32 characters (leave it blank to have one generated).");
  if (v.DENTALLY_WEBHOOK_SECRET && v.DENTALLY_WEBHOOK_SECRET.length < 16) {
    errors.push("DENTALLY_WEBHOOK_SECRET must be at least 16 characters (leave it blank to have one generated).");
  }

  // Optional groups must be complete or empty.
  const group = (label, keys, anyOf) => {
    const set = keys.filter((k) => v[k]);
    if (set.length > 0 && set.length < keys.length) {
      warnings.push(`${label} is only partly filled in (missing: ${keys.filter((k) => !v[k]).join(", ")}). It will be skipped.`);
    }
    if (anyOf && set.length > 0 && !anyOf.some((k) => v[k])) warnings.push(`${label}: set one of ${anyOf.join(" or ")}.`);
  };
  group("Dentally", ["DENTALLY_API_BASE_URL", "DENTALLY_API_TOKEN"]);
  group("Slack", ["SLACK_BOT_TOKEN", "SLACK_SIGNING_SECRET", "SLACK_CHANNEL_ID"]);
  if (v.TWILIO_ACCOUNT_SID || v.TWILIO_AUTH_TOKEN) {
    group("Twilio", ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"]);
    if (!v.TWILIO_MESSAGING_SERVICE_SID && !v.TWILIO_SMS_FROM) {
      warnings.push("Twilio: set TWILIO_MESSAGING_SERVICE_SID or TWILIO_SMS_FROM.");
    }
  }
  if (!v.OPERATOR_ALERT_EMAIL) warnings.push("OPERATOR_ALERT_EMAIL is empty, so health alerts will not be emailed.");
  if (!v.SHADOW_TEST_EMAIL && !v.SHADOW_TEST_PHONE) {
    warnings.push("SHADOW_TEST_EMAIL / SHADOW_TEST_PHONE are empty: shadow mode has nowhere to redirect messages.");
  }
  if (!v.VERCEL_TOKEN || !v.VERCEL_PROJECT_ID) {
    warnings.push("VERCEL_TOKEN / VERCEL_PROJECT_ID are empty: a clinics/<slug>.vercel.env file will be written for you to paste instead.");
  }
  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Secrets, derived values
// ---------------------------------------------------------------------------

export function randomSecret(bytes = 32) {
  return randomBytes(bytes).toString("hex");
}

/** Secrets that must exist: returns only the ones to generate now. Existing valid values are never replaced. */
export function secretsToGenerate(v, generate = randomSecret) {
  const out = {};
  if (!v.CRON_SECRET || v.CRON_SECRET.length < 32) out.CRON_SECRET = generate(32);
  if (!v.DENTALLY_WEBHOOK_SECRET || v.DENTALLY_WEBHOOK_SECRET.length < 16) out.DENTALLY_WEBHOOK_SECRET = generate(24);
  return out;
}

export const supabaseUrl = (ref) => `https://${ref}.supabase.co`;
export const appUrlOf = (v) => v.APP_URL.replace(/\/+$/, "");

/** Variables for the clinic's Vercel project. Only non-empty values are sent. */
export function appEnvVars(v, supabaseKeys) {
  const vars = {
    NEXT_PUBLIC_APP_URL: appUrlOf(v),
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl(v.SUPABASE_PROJECT_REF),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: supabaseKeys.publishableKey,
    SUPABASE_SECRET_KEY: supabaseKeys.secretKey,
  };
  for (const key of PASS_THROUGH_KEYS) if (v[key]) vars[key] = v[key];
  return vars;
}

/** NEXT_PUBLIC_* values are not secret; everything else is stored encrypted. */
export const vercelVarType = (key) => (key.startsWith("NEXT_PUBLIC_") ? "plain" : "encrypted");

export function toVercelEnvFile(vars) {
  const lines = ["# Paste into Vercel → Project → Settings → Environment Variables (Import .env). Contains secrets: keep private."];
  for (const [k, val] of Object.entries(vars)) lines.push(`${k}=${val}`);
  return lines.join("\n") + "\n";
}

/** Webhook / interactivity URLs to paste into the other services. */
export function webhookUrls(v) {
  const base = appUrlOf(v);
  return {
    join: `${base}/join/${v.CLINIC_SLUG}`,
    dentally: v.DENTALLY_WEBHOOK_SECRET ? `${base}/api/webhooks/dentally/${v.DENTALLY_WEBHOOK_SECRET}` : null,
    twilioInbound: `${base}/api/webhooks/twilio/inbound`,
    twilioStatus: `${base}/api/webhooks/twilio/status`,
    slackInteractivity: `${base}/api/webhooks/slack/actions`,
    health: `${base}/api/health`,
  };
}

// ---------------------------------------------------------------------------
// Supabase Auth config (step 3)
// ---------------------------------------------------------------------------

// The app's /auth/confirm route exchanges token_hash for a session (server-side flow).
const link = (type, next) => `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=${type}&next=${next}`;

const emailShell = (clinicName, heading, text, url, button) =>
  `<div style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;max-width:520px"><h2 style="color:#1e3a5f">${heading}</h2>` +
  `<p>${text}</p><p><a href="${url}" style="display:inline-block;background:#1e3a5f;color:#ffffff;padding:12px 20px;border-radius:6px;text-decoration:none">${button}</a></p>` +
  `<p style="color:#475569;font-size:13px">${clinicName} appointment recovery. If you were not expecting this email, you can ignore it.</p></div>`;

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function authConfigPayload(v) {
  const base = appUrlOf(v);
  const name = escapeHtml(v.CLINIC_NAME);
  return {
    site_url: base,
    uri_allow_list: `${base}/auth/confirm`,
    smtp_host: v.SMTP_HOST,
    smtp_port: String(v.SMTP_PORT || 587),
    smtp_user: v.SMTP_USER,
    smtp_pass: v.SMTP_PASS,
    smtp_admin_email: v.SMTP_FROM,
    smtp_sender_name: v.SMTP_FROM_NAME || v.CLINIC_NAME,
    mailer_subjects_invite: `You're invited to ${v.CLINIC_NAME} appointment recovery`,
    mailer_templates_invite_content: emailShell(
      name,
      "You've been invited",
      `${name} has invited you to its appointment recovery system. Choose a password to get started.`,
      link("invite", "/set-password"),
      "Accept invitation",
    ),
    mailer_subjects_recovery: "Reset your password",
    mailer_templates_recovery_content: emailShell(
      name,
      "Reset your password",
      "We received a request to reset your password. Use the button below to choose a new one.",
      link("recovery", "/set-password"),
      "Reset password",
    ),
  };
}

// ---------------------------------------------------------------------------
// Migrations (step 2)
// ---------------------------------------------------------------------------

/** "20270101000004_rate_limits.sql" -> { file, version: "20270101000004", name: "rate_limits" } */
export function parseMigrationFile(file) {
  const m = file.match(/^(\d{14})_(.+)\.sql$/);
  return m ? { file, version: m[1], name: m[2] } : null;
}

export function sortedMigrations(files) {
  return files
    .map(parseMigrationFile)
    .filter(Boolean)
    .sort((a, b) => a.version.localeCompare(b.version));
}

/**
 * Pending = not applied. A migration counts as applied if its version OR its name is already recorded
 * (a project set up through the Supabase tools records the same migration under a different timestamp).
 */
export function pendingMigrations(files, applied) {
  const versions = new Set(applied.map((a) => a.version));
  const names = new Set(applied.map((a) => a.name));
  return sortedMigrations(files).filter((m) => !versions.has(m.version) && !names.has(m.name));
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

export const ENSURE_MIGRATION_TABLE_SQL = `
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text not null primary key,
  statements text[],
  name text
);
select version, name from supabase_migrations.schema_migrations order by version;`;

/** The migration itself plus its bookkeeping row, in one request so both happen or neither. */
export function migrationRunSql(migration, sql) {
  return `${sql.replace(/\s+$/, "")}\n;\ninsert into supabase_migrations.schema_migrations (version, name) values (${q(migration.version)}, ${q(migration.name)}) on conflict do nothing;`;
}

// ---------------------------------------------------------------------------
// pg_cron jobs (step 8)
// ---------------------------------------------------------------------------

/** Jobs this clinic should have. dentally-poll only when a Dentally token is configured. */
export function cronJobsFor(v) {
  return CRON_JOBS.map((job) => ({ ...job, enabled: job.needs ? Boolean(v[job.needs]) : true }));
}

/**
 * SQL that (re)creates the cron jobs. The app address and the secret are kept in Supabase Vault, not in the
 * job text, so they can be rotated without rescheduling. Safe to run again.
 */
export function cronSql(v) {
  const jobs = cronJobsFor(v);
  const secret = q(v.CRON_SECRET);
  const url = q(appUrlOf(v));
  const upsertSecret = (name, value, description) => `
  select id into v_id from vault.secrets where name = ${q(name)};
  if v_id is null then
    perform vault.create_secret(${value}, ${q(name)}, ${q(description)});
  else
    perform vault.update_secret(v_id, ${value});
  end if;`;

  const lines = [
    "create extension if not exists pg_cron;",
    "create extension if not exists pg_net;",
    "do $$",
    "declare v_id uuid;",
    "begin",
    upsertSecret("cron_secret", secret, "Bearer secret for the app's cron routes"),
    upsertSecret("app_url", url, "Public address of this clinic's app"),
    "end $$;",
  ];
  for (const job of jobs) {
    if (job.enabled) {
      lines.push(
        `select cron.schedule(${q(job.name)}, ${q(job.schedule)}, $job$ select net.http_get(` +
          `url := (select decrypted_secret from vault.decrypted_secrets where name = 'app_url') || ${q(job.path)}, ` +
          `headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')), ` +
          `timeout_milliseconds := 25000) $job$);`,
      );
    } else {
      lines.push(`select cron.unschedule(${q(job.name)}) where exists (select 1 from cron.job where jobname = ${q(job.name)});`);
    }
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Plan (printed by --dry-run and before a real run)
// ---------------------------------------------------------------------------

export function buildPlan(v) {
  const jobs = cronJobsFor(v);
  const hasVercel = Boolean(v.VERCEL_TOKEN && v.VERCEL_PROJECT_ID);
  return [
    `Read the Supabase keys for project ${v.SUPABASE_PROJECT_REF || "(ref missing)"} via the Management API`,
    "Apply pending supabase/migrations/*.sql (tracked in supabase_migrations.schema_migrations)",
    `Configure Supabase Auth: Site URL ${v.APP_URL || "(APP_URL missing)"}, redirect ${v.APP_URL || ""}/auth/confirm, SMTP ${v.SMTP_HOST || "(missing)"}, invite + reset email templates`,
    `Create the clinic "${v.CLINIC_NAME || "(missing)"}" (/join/${v.CLINIC_SLUG || "?"}) and its clinic_config row, if they do not exist`,
    `Invite ${v.MANAGER_EMAIL || "(MANAGER_EMAIL missing)"} as owner (skipped if the clinic already has an owner)`,
    "Generate CRON_SECRET and DENTALLY_WEBHOOK_SECRET if empty and save them into the clinic file",
    hasVercel
      ? `Push the app environment variables to Vercel project ${v.VERCEL_PROJECT_ID}`
      : `Write clinics/${v.CLINIC_SLUG || "<slug>"}.vercel.env for you to paste into Vercel`,
    `Create pg_cron jobs: ${jobs.filter((j) => j.enabled).map((j) => j.name).join(", ")}${jobs.some((j) => !j.enabled) ? ` (not scheduled: ${jobs.filter((j) => !j.enabled).map((j) => j.name).join(", ")})` : ""}`,
    "Print the webhook URLs for Dentally, Twilio and Slack",
  ];
}
