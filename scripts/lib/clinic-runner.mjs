// The steps of `pnpm clinic:setup` and `pnpm clinic:migrate-all`. Everything that touches the outside world
// (files, HTTP, Supabase) is passed in as `deps`, so the order and the "safe to re-run" behaviour are unit tested.
// Source: SYSTEM_BUILD_GUIDE.md §13.

import {
  ENSURE_MIGRATION_TABLE_SQL,
  appEnvVars,
  appUrlOf,
  authConfigPayload,
  buildPlan,
  cronJobsFor,
  cronSql,
  migrationRunSql,
  parseEnv,
  pendingMigrations,
  secretsToGenerate,
  setEnvValue,
  toVercelEnvFile,
  validateClinicEnv,
  vercelVarType,
  webhookUrls,
} from "./clinic-env.mjs";

/**
 * @typedef {object} Deps
 * @property {{ readFile(p: string): Promise<string>, writeFile(p: string, data: string, mode?: number): Promise<void>, listMigrationFiles(): Promise<string[]>, readMigration(file: string): Promise<string> }} files
 * @property {(token: string) => import("./api-clients.mjs").SupabaseMgmt} mgmt
 * @property {(token: string, teamId?: string) => import("./api-clients.mjs").VercelClient} vercel
 * @property {(url: string, secretKey: string) => any} createAdmin
 * @property {(msg: string) => void} log
 * @property {(bytes: number) => string} [generate]
 */

const say = (deps, msg) => deps.log(msg);

/** Step 2 only. Used by setup and by migrate-all. Returns the names of migrations applied now. */
export async function applyMigrations(deps, mgmt, ref) {
  const files = await deps.files.listMigrationFiles();
  const rows = await mgmt.query(ref, ENSURE_MIGRATION_TABLE_SQL);
  const applied = (Array.isArray(rows) ? rows : []).map((r) => ({ version: String(r.version), name: r.name ?? null }));
  const pending = pendingMigrations(files, applied);
  const done = [];
  for (const m of pending) {
    const sql = await deps.files.readMigration(m.file);
    await mgmt.query(ref, migrationRunSql(m, sql));
    done.push(m.name);
  }
  return done;
}

function loadValues(text) {
  return parseEnv(text);
}

/** @param {Deps} deps */
export async function runClinicSetup(deps, filePath, { dryRun = false } = {}) {
  let text = await deps.files.readFile(filePath);
  let v = loadValues(text);

  const { errors, warnings } = validateClinicEnv(v);
  for (const w of warnings) say(deps, `  warning: ${w}`);
  if (errors.length > 0) {
    for (const e of errors) say(deps, `  ERROR: ${e}`);
    return { ok: false, errors, warnings };
  }

  if (dryRun) {
    say(deps, "\nDry run — nothing was changed. Plan:");
    buildPlan(v).forEach((step, i) => say(deps, `  ${i + 1}. ${step}`));
    const urls = webhookUrls({ ...v, DENTALLY_WEBHOOK_SECRET: v.DENTALLY_WEBHOOK_SECRET || "<generated on the real run>" });
    say(deps, `\nAddresses after setup:\n  Join page: ${urls.join}`);
    return { ok: true, errors, warnings, dryRun: true };
  }

  const ref = v.SUPABASE_PROJECT_REF;
  const mgmt = deps.mgmt(v.SUPABASE_ACCESS_TOKEN);

  say(deps, "1/9 Reading Supabase keys…");
  const keys = await mgmt.getApiKeys(ref);

  say(deps, "2/9 Applying migrations…");
  const applied = await applyMigrations(deps, mgmt, ref);
  say(deps, applied.length ? `    applied: ${applied.join(", ")}` : "    nothing to apply (already up to date)");

  say(deps, "3/9 Configuring Supabase Auth (site URL, redirect, SMTP, email templates)…");
  await mgmt.patchAuthConfig(ref, authConfigPayload(v));

  say(deps, "4/9 Creating the clinic and its settings row if missing…");
  const admin = deps.createAdmin(`https://${ref}.supabase.co`, keys.secretKey);
  const clinicId = await ensureClinic(admin, v, deps);

  say(deps, "5/9 Inviting the practice manager as owner if there is no owner yet…");
  await ensureOwner(admin, v, clinicId, deps);

  say(deps, "6/9 Generating secrets if empty…");
  const generated = secretsToGenerate(v, deps.generate);
  for (const [key, value] of Object.entries(generated)) {
    text = setEnvValue(text, key, value);
    v = { ...v, [key]: value };
  }
  if (Object.keys(generated).length > 0) {
    await deps.files.writeFile(filePath, text, 0o600);
    say(deps, `    saved into ${filePath}: ${Object.keys(generated).join(", ")}`);
  } else {
    say(deps, "    already set");
  }

  say(deps, "7/9 App environment variables…");
  const vars = appEnvVars(v, keys);
  if (v.VERCEL_TOKEN && v.VERCEL_PROJECT_ID) {
    const list = Object.entries(vars).map(([key, value]) => ({ key, value, type: vercelVarType(key) }));
    const count = await deps.vercel(v.VERCEL_TOKEN, v.VERCEL_TEAM_ID || undefined).pushEnv(v.VERCEL_PROJECT_ID, list);
    say(deps, `    pushed ${count} variables to Vercel (redeploy the project so they take effect)`);
  } else {
    const out = filePath.replace(/\.env$/, "") + ".vercel.env";
    await deps.files.writeFile(out, toVercelEnvFile(vars), 0o600);
    say(deps, `    wrote ${out} — paste it into Vercel (it holds secrets; do not share or commit it)`);
  }

  say(deps, "8/9 Scheduling the cron jobs (pg_cron)…");
  await mgmt.query(ref, cronSql(v));
  const jobs = cronJobsFor(v);
  say(deps, `    scheduled: ${jobs.filter((j) => j.enabled).map((j) => j.name).join(", ")}`);
  const skipped = jobs.filter((j) => !j.enabled).map((j) => j.name);
  if (skipped.length) say(deps, `    not scheduled (not configured yet): ${skipped.join(", ")}`);

  say(deps, "9/9 Done. Paste these into the other services:");
  const urls = webhookUrls(v);
  say(deps, `    Join page (QR code):  ${urls.join}`);
  say(deps, `    Dentally webhook:     ${urls.dentally ?? "(set DENTALLY_WEBHOOK_SECRET)"}`);
  say(deps, `    Twilio inbound:       ${urls.twilioInbound}`);
  say(deps, `    Twilio status:        ${urls.twilioStatus}`);
  say(deps, `    Slack interactivity:  ${urls.slackInteractivity}`);
  say(deps, `    Health (needs secret): ${urls.health}`);
  say(deps, "\nNext: DPA signed · prices + doctors in Settings · QR card printed · Dentally token + webhook · Twilio webhooks · Slack app · one week in shadow mode · then engine on, shadow off.");
  return { ok: true, errors, warnings, clinicId, applied };
}

async function ensureClinic(admin, v, deps) {
  const existing = await admin.from("clinics").select("id").eq("slug", v.CLINIC_SLUG).maybeSingle();
  if (existing.error) throw new Error(`Could not look up the clinic: ${existing.error.message}`);
  let id = existing.data?.id;
  if (id) {
    say(deps, "    clinic already exists");
  } else {
    const inserted = await admin
      .from("clinics")
      .insert({
        name: v.CLINIC_NAME,
        slug: v.CLINIC_SLUG,
        contact_email: v.CLINIC_EMAIL,
        contact_phone: v.CLINIC_PHONE || null,
        address: v.CLINIC_ADDRESS || null,
      })
      .select("id")
      .single();
    if (inserted.error || !inserted.data) throw new Error(`Could not create the clinic: ${inserted.error?.message ?? "unknown error"}`);
    id = inserted.data.id;
    say(deps, "    clinic created");
  }
  const config = await admin.from("clinic_config").select("id").eq("clinic_id", id).maybeSingle();
  if (config.error) throw new Error(`Could not look up clinic settings: ${config.error.message}`);
  if (!config.data) {
    const created = await admin.from("clinic_config").insert({ clinic_id: id });
    if (created.error) throw new Error(`Could not create clinic settings: ${created.error.message}`);
    say(deps, "    settings row created (engine OFF, shadow mode ON)");
  }
  return id;
}

async function ensureOwner(admin, v, clinicId, deps) {
  const owner = await admin.from("clinic_users").select("user_id").eq("clinic_id", clinicId).eq("role", "owner").maybeSingle();
  if (owner.error) throw new Error(`Could not check the owner: ${owner.error.message}`);
  if (owner.data) {
    say(deps, "    owner already exists");
    return;
  }
  const invite = await admin.auth.admin.inviteUserByEmail(v.MANAGER_EMAIL, {
    redirectTo: `${appUrlOf(v)}/auth/confirm?next=/set-password`,
  });
  if (invite.error || !invite.data?.user) {
    throw new Error(`Could not invite ${v.MANAGER_EMAIL}: ${invite.error?.message ?? "unknown error"}. If that email already has an account, remove it in Supabase → Authentication first.`);
  }
  const link = await admin.from("clinic_users").insert({ clinic_id: clinicId, user_id: invite.data.user.id, role: "owner" });
  if (link.error) throw new Error(`Invited, but could not link the owner: ${link.error.message}`);
  say(deps, `    invitation sent to ${v.MANAGER_EMAIL}`);
}

/**
 * migrate-all: apply pending migrations to every clinic file. One clinic failing does not stop the others.
 * @param {Deps} deps
 * @param {string[]} filePaths
 */
export async function runMigrateAll(deps, filePaths, { dryRun = false } = {}) {
  const results = [];
  if (filePaths.length === 0) {
    say(deps, "No clinic files found in clinics/*.env");
    return { ok: true, results };
  }
  for (const path of filePaths) {
    const v = parseEnv(await deps.files.readFile(path));
    const label = v.CLINIC_SLUG || path;
    const missing = ["SUPABASE_PROJECT_REF", "SUPABASE_ACCESS_TOKEN"].filter((k) => !v[k]);
    if (missing.length) {
      say(deps, `✗ ${label}: missing ${missing.join(", ")}`);
      results.push({ clinic: label, ok: false });
      continue;
    }
    if (dryRun) {
      say(deps, `• ${label}: would apply pending migrations to project ${v.SUPABASE_PROJECT_REF}`);
      results.push({ clinic: label, ok: true, dryRun: true });
      continue;
    }
    try {
      const applied = await applyMigrations(deps, deps.mgmt(v.SUPABASE_ACCESS_TOKEN), v.SUPABASE_PROJECT_REF);
      say(deps, `✓ ${label}: ${applied.length ? `applied ${applied.join(", ")}` : "already up to date"}`);
      results.push({ clinic: label, ok: true, applied });
    } catch (error) {
      say(deps, `✗ ${label}: ${error instanceof Error ? error.message : String(error)}`);
      results.push({ clinic: label, ok: false });
    }
  }
  return { ok: results.every((r) => r.ok), results };
}
