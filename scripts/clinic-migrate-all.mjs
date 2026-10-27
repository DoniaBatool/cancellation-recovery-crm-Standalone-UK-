#!/usr/bin/env node
// pnpm clinic:migrate-all [--dry-run]
// Applies pending supabase/migrations/*.sql to every clinic listed in clinics/*.env. Source: guide §13 step 3.
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrateAll } from "./lib/clinic-runner.mjs";
import { realDeps } from "./clinic-setup.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "clinics");
const dryRun = process.argv.includes("--dry-run");

const names = (await readdir(dir)).filter((n) => n.endsWith(".env") && !n.endsWith(".vercel.env") && n !== "clinic.example.env");
const result = await runMigrateAll(realDeps, names.sort().map((n) => path.join(dir, n)), { dryRun });
process.exit(result.ok ? 0 : 1);
