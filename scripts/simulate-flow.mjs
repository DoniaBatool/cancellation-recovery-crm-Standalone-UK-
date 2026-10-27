#!/usr/bin/env node
// pnpm simulate [--fast] [--keep]
// Runs the whole recovery loop against the Supabase project in .env.local (use a DEV project).
// Nothing is sent to anyone: a recording notifier stands in for email, SMS and Slack. Source: guide §14.
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "./lib/clinic-env.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const fast = args.includes("--fast");
const keep = args.includes("--keep");

const envFile = path.join(root, ".env.local");
const fromFile = existsSync(envFile) ? parseEnv(readFileSync(envFile, "utf8")) : {};
const env = { ...fromFile, ...process.env };

const missing = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SECRET_KEY"].filter((k) => !env[k]);
if (missing.length) {
  console.error(`Missing ${missing.join(", ")}. Fill in .env.local first.`);
  process.exit(2);
}
console.log(`Simulation target: ${new URL(env.NEXT_PUBLIC_SUPABASE_URL).host}${fast ? "  (--fast: cron path)" : ""}`);
console.log("It creates its own test clinic and deletes it at the end. Nothing is emailed or texted.\n");

const vitest = path.join(root, "node_modules", ".bin", "vitest");
const result = spawnSync(vitest, ["run", "--config", "scripts/simulate/vitest.config.mts", "--reporter", "verbose"], {
  cwd: root,
  stdio: "inherit",
  env: { ...env, SIM_FAST: fast ? "1" : "", SIM_KEEP: keep ? "1" : "" },
});
process.exit(result.status ?? 1);
