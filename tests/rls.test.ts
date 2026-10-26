import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";

// Real Row Level Security checks: runs scripts/rls-check.sh, which applies the real
// migrations to a throwaway local Postgres and tests with simulated Supabase roles.
// Exit code 3 = no local Postgres installed -> the check is reported as skipped, not passed.
const root = path.resolve(import.meta.dirname, "..");
const run = spawnSync("bash", ["scripts/rls-check.sh"], { cwd: root, encoding: "utf8", timeout: 150_000 });
const skipped = run.status === 3;

describe("row level security (real Postgres)", () => {
  it.skipIf(skipped)("passes every isolation and permission assertion", () => {
    expect(run.stderr, run.stderr).not.toMatch(/RLS FAIL|ERROR/);
    expect(run.stdout.trim()).toBe("RLS_ALL_OK");
    expect(run.status).toBe(0);
  });
});
