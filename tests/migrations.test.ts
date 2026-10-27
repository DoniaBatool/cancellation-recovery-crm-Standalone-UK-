import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const root = path.resolve(import.meta.dirname, "..");
const guide = readFileSync(path.join(root, "SYSTEM_BUILD_GUIDE.md"), "utf8");
const schemaSql = readFileSync(path.join(root, "supabase/migrations/20270101000001_schema.sql"), "utf8");
const rlsSql = readFileSync(path.join(root, "supabase/migrations/20270101000002_rls.sql"), "utf8");
const v21Sql = readFileSync(path.join(root, "supabase/migrations/20270101000003_v21_schema_changes.sql"), "utf8");
const rateLimitSql = readFileSync(path.join(root, "supabase/migrations/20270101000004_rate_limits.sql"), "utf8");
const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");

/** The first ```sql block after a heading in the guide. */
function guideSql(heading: string): string {
  const start = guide.indexOf(heading);
  const open = guide.indexOf("```sql\n", start);
  const close = guide.indexOf("\n```", open + 7);
  return guide.slice(open + 7, close);
}

/** Our migration files start with a "-- Source: ..." header, then a blank line. Drop only that header. */
const withoutHeader = (sql: string) => sql.replace(/^-- Source:[^\n]*\n(--[^\n]*\n)*\n/, "");

const body = (sql: string) =>
  sql
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .trim();

/** Drop SQL comments and blank lines, so only real statements are compared. */
const code = (sql: string) =>
  sql
    .split("\n")
    .map((l) => l.replace(/\s*--.*$/, "").trimEnd())
    .filter((l) => l.trim() !== "")
    .join("\n");

/**
 * Migrations 0001 and 0002 are already applied to the live Supabase project, so they are frozen
 * (they hold the guide v2.0 text). Guide v2.1 changes are added in 0003 only.
 */
const FROZEN_SHA256 = {
  "20270101000001_schema.sql": "bd2838489c4179693bdf755e15c56978b2604e64a640f8b1173951cfdb1c6ff3",
  "20270101000002_rls.sql": "39026ea4701935bcfa4becf271b9d3a62c97c92050ab5c768c0665ba6c2d6603",
} as const;

describe("migrations match SYSTEM_BUILD_GUIDE.md (v2.1)", () => {
  it("guide is version 2.1", () => {
    expect(guide).toMatch(/_Version 2\.1 /);
  });

  it("0001 and 0002 are frozen (already applied to the live project)", () => {
    expect(sha256(schemaSql)).toBe(FROZEN_SHA256["20270101000001_schema.sql"]);
    expect(sha256(rlsSql)).toBe(FROZEN_SHA256["20270101000002_rls.sql"]);
  });

  it("0001 + 0003 give exactly the guide §5.1 schema (comments ignored)", () => {
    // Apply the four v2.1 changes by hand to the frozen v2.0 text...
    let expected = code(withoutHeader(schemaSql));
    expected = expected.replace(
      "offer_expiry_minutes INT NOT NULL DEFAULT 15 CHECK",
      "offer_expiry_minutes INT NOT NULL DEFAULT 30 CHECK",
    );
    expected = expected.replace(/^ *booking_mode TEXT .*\n/m, "");
    expected = expected.replace(/^ *pms_new_appointment_id TEXT.*\n/m, "");
    expected = expected.replace(/^( *)booked_in_pms_at TIMESTAMPTZ,/m, "$1slack_message_ts TEXT,\n$1booked_in_pms_at TIMESTAMPTZ,");
    // ...and it must equal the guide.
    expect(expected).toBe(code(guideSql("### 5.1 Schema")));
  });

  it("0003 contains exactly the four v2.1 statements", () => {
    const statements = code(v21Sql)
      .split(";")
      .map((x) => x.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    expect(statements).toEqual([
      "ALTER TABLE public.clinic_config ALTER COLUMN offer_expiry_minutes SET DEFAULT 30",
      "ALTER TABLE public.clinic_config DROP COLUMN booking_mode",
      "ALTER TABLE public.recovery_pipeline DROP COLUMN pms_new_appointment_id",
      "ALTER TABLE public.recovery_pipeline ADD COLUMN slack_message_ts TEXT",
    ]);
  });

  it("RLS migration is §5.2 verbatim", () => {
    expect(body(withoutHeader(rlsSql))).toBe(body(guideSql("### 5.2 Row Level Security")));
  });

  it("guide v2.1 no longer has booking_mode or pms_new_appointment_id in the schema", () => {
    const sql = guideSql("### 5.1 Schema");
    expect(sql).not.toContain("booking_mode");
    expect(sql).not.toContain("pms_new_appointment_id");
    expect(sql).toContain("slack_message_ts TEXT");
    expect(sql).toContain("offer_expiry_minutes INT NOT NULL DEFAULT 30");
  });
});

describe("schema sanity", () => {
  const tables = [
    "clinics",
    "clinic_users",
    "clinic_config",
    "waitlist",
    "cancellation_events",
    "recovery_pipeline",
    "recovery_pipeline_history",
    "waitlist_offers",
    "messages",
    "engine_state",
  ];

  it("creates all ten tables", () => {
    for (const t of tables) expect(schemaSql).toContain(`CREATE TABLE public.${t} `);
  });

  it("enables row level security on every table", () => {
    for (const t of tables) expect(rlsSql).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`);
  });

  it("has no policy at all for engine_state (service role only)", () => {
    expect(rlsSql).not.toMatch(/ON public\.engine_state/);
  });

  it("never lets the API change pipeline stages or offers (no write policies)", () => {
    for (const t of ["recovery_pipeline", "recovery_pipeline_history", "waitlist_offers", "messages", "cancellation_events"]) {
      expect(rlsSql).not.toMatch(new RegExp(`ON public\\.${t} FOR (INSERT|UPDATE|DELETE)`));
    }
  });

  it("uses fixed migration names in order", () => {
    expect("20270101000001_schema.sql" < "20270101000002_rls.sql").toBe(true);
    expect("20270101000002_rls.sql" < "20270101000003_v21_schema_changes.sql").toBe(true);
    expect("20270101000003_v21_schema_changes.sql" < "20270101000004_rate_limits.sql").toBe(true);
  });

  it("0004 adds only the rate-limit table and function, locked to the service role (guide §15)", () => {
    const sql = code(rateLimitSql);
    expect(sql).toContain("CREATE TABLE public.rate_limits");
    expect(sql).toContain("ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY");
    expect(sql).not.toMatch(/CREATE POLICY/);
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.rate_limit_hit(TEXT, INT, INT) FROM PUBLIC, anon, authenticated");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.rate_limit_hit(TEXT, INT, INT) TO service_role");
    expect(sql).toContain("SECURITY DEFINER");
    expect(sql).toContain("SET search_path = public");
    expect((sql.match(/CREATE TABLE/g) ?? []).length).toBe(1);
  });
});
