#!/usr/bin/env node
// pnpm clinic:setup clinics/<slug>.env [--dry-run]
// Sets up (or re-checks) one clinic from one env file. Safe to re-run. Source: SYSTEM_BUILD_GUIDE.md §13.
import { chmod, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseMgmt, createVercel } from "./lib/api-clients.mjs";
import { randomSecret } from "./lib/clinic-env.mjs";
import { runClinicSetup } from "./lib/clinic-runner.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = path.join(root, "supabase", "migrations");

export const realDeps = {
  files: {
    readFile: (p) => readFile(p, "utf8"),
    writeFile: async (p, data, mode) => {
      await writeFile(p, data, { mode: mode ?? 0o600 });
      if (mode) await chmod(p, mode);
    },
    listMigrationFiles: () => readdir(migrationsDir),
    readMigration: (file) => readFile(path.join(migrationsDir, file), "utf8"),
  },
  mgmt: (token) => createSupabaseMgmt({ token }),
  vercel: (token, teamId) => createVercel({ token, teamId }),
  createAdmin: (url, secretKey) => createClient(url, secretKey, { auth: { persistSession: false, autoRefreshToken: false } }),
  log: (msg) => console.log(msg),
  generate: randomSecret,
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) {
    console.error("Usage: pnpm clinic:setup clinics/<slug>.env [--dry-run]");
    process.exit(2);
  }
  try {
    const result = await runClinicSetup(realDeps, path.resolve(file), { dryRun });
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.error(`\nSetup stopped: ${error instanceof Error ? error.message : String(error)}`);
    console.error("Nothing is lost: fix the problem and run the same command again (every step is safe to repeat).");
    process.exit(1);
  }
}
