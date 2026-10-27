import { describe, expect, it } from "vitest";
import { applyMigrations, runClinicSetup, runMigrateAll, type Deps } from "../scripts/lib/clinic-runner.mjs";
import { createSupabaseMgmt, createVercel, pickKeys, ApiCallError } from "../scripts/lib/api-clients.mjs";
import { memoryDb } from "./helpers/memory-db";

const FILE = `CLINIC_NAME=Smile Dental
CLINIC_SLUG=smile-dental
CLINIC_EMAIL=reception@smile.co.uk
MANAGER_EMAIL=manager@smile.co.uk
APP_URL=https://recovery.smile.co.uk
SUPABASE_PROJECT_REF=abcdefghijklmnopqrst
SUPABASE_ACCESS_TOKEN=sbp_abc
SMTP_HOST=smtp-relay.brevo.com
SMTP_USER=u
SMTP_PASS=p
SMTP_FROM=appointments@smile.co.uk
DENTALLY_API_BASE_URL=https://dentally.invalid
DENTALLY_API_TOKEN=tok
CRON_SECRET=
DENTALLY_WEBHOOK_SECRET=
`;

function world(opts: { appliedMigrations?: Array<{ version: string; name: string }>; vercel?: boolean; fileText?: string } = {}) {
  const db = memoryDb();
  const calls: string[] = [];
  const sqlRuns: string[] = [];
  const written: Record<string, string> = {};
  const logs: string[] = [];
  const pushed: Array<{ key: string; value: string; type: string }> = [];
  let invites = 0;
  const migrationSql: Record<string, string> = {
    "20270101000001_schema.sql": "create table a();",
    "20270101000002_rls.sql": "alter table a enable row level security;",
  };
  let text = (opts.fileText ?? FILE) + (opts.vercel ? "VERCEL_TOKEN=vt\nVERCEL_PROJECT_ID=prj_1\n" : "");
  const recorded = [...(opts.appliedMigrations ?? [])];

  const admin = {
    from: (t: string) => (db.db as any).from(t),
    auth: {
      admin: {
        inviteUserByEmail: async (email: string) => {
          invites += 1;
          calls.push(`invite:${email}`);
          return { data: { user: { id: "user-1" } }, error: null };
        },
      },
    },
  };

  const deps: Deps = {
    files: {
      readFile: async () => text,
      writeFile: async (p, data) => {
        written[p] = data;
        if (p.endsWith("smile-dental.env") || p === "clinics/smile-dental.env") text = data;
      },
      listMigrationFiles: async () => Object.keys(migrationSql),
      readMigration: async (f) => migrationSql[f]!,
    },
    mgmt: () => ({
      getApiKeys: async () => {
        calls.push("keys");
        return { publishableKey: "pk", secretKey: "sk" };
      },
      query: async (_ref, sql) => {
        sqlRuns.push(sql);
        if (sql.includes("from supabase_migrations.schema_migrations order by")) return recorded;
        const m = sql.match(/values \('(\d+)', '([^']+)'\)/);
        if (m) recorded.push({ version: m[1]!, name: m[2]! });
        if (sql.includes("cron.schedule")) calls.push("cron");
        return [];
      },
      patchAuthConfig: async () => {
        calls.push("auth");
        return {};
      },
    }),
    vercel: () => ({
      pushEnv: async (_p, vars) => {
        calls.push("vercel");
        pushed.push(...vars);
        return vars.length;
      },
    }),
    createAdmin: () => admin,
    log: (m) => logs.push(m),
    generate: (n) => "g".repeat(n * 2),
  };
  return { deps, db, calls, sqlRuns, written, logs, pushed, get invites() { return invites; }, get text() { return text; } };
}

describe("runClinicSetup", () => {
  it("dry run validates and prints the plan, and changes nothing", async () => {
    const w = world();
    const r = await runClinicSetup(w.deps, "clinics/smile-dental.env", { dryRun: true });
    expect(r.ok).toBe(true);
    expect(w.calls).toEqual([]);
    expect(Object.keys(w.written)).toEqual([]);
    expect(w.logs.join("\n")).toMatch(/Dry run/);
    expect(w.logs.join("\n")).toMatch(/9\. Print the webhook URLs/);
  });

  it("stops with errors before touching anything when the file is wrong", async () => {
    const w = world({ fileText: "CLINIC_NAME=x\n" });
    const r = await runClinicSetup(w.deps, "clinics/smile-dental.env");
    expect(r.ok).toBe(false);
    expect(w.calls).toEqual([]);
  });

  it("runs every step in order on a fresh project", async () => {
    const w = world();
    const r = await runClinicSetup(w.deps, "clinics/smile-dental.env");
    expect(r.ok).toBe(true);
    expect(w.calls).toEqual(["keys", "auth", "invite:manager@smile.co.uk", "cron"]);
    expect(r.applied).toEqual(["schema", "rls"]);
    expect(w.db.tables.clinics?.length).toBe(1);
    expect(w.db.tables.clinics?.[0]).toMatchObject({ slug: "smile-dental", name: "Smile Dental", contact_email: "reception@smile.co.uk" });
    expect(w.db.tables.clinic_config?.length).toBe(1);
    expect(w.db.tables.clinic_users?.[0]).toMatchObject({ role: "owner", user_id: "user-1" });
  });

  it("saves generated secrets back into the clinic file and uses them for the cron jobs", async () => {
    const w = world();
    await runClinicSetup(w.deps, "clinics/smile-dental.env");
    expect(w.text).toMatch(/CRON_SECRET=g{64}/);
    expect(w.text).toMatch(/DENTALLY_WEBHOOK_SECRET=g{48}/);
    expect(w.sqlRuns.find((s) => s.includes("cron.schedule"))).toContain("g".repeat(64));
  });

  it("writes a .vercel.env file when there is no Vercel token", async () => {
    const w = world();
    await runClinicSetup(w.deps, "clinics/smile-dental.env");
    const out = w.written["clinics/smile-dental.vercel.env"];
    expect(out).toContain("SUPABASE_SECRET_KEY=sk");
    expect(out).toContain("NEXT_PUBLIC_SUPABASE_URL=https://abcdefghijklmnopqrst.supabase.co");
    expect(w.calls).not.toContain("vercel");
  });

  it("pushes to Vercel when a token is given, as plain/encrypted", async () => {
    const w = world({ vercel: true });
    await runClinicSetup(w.deps, "clinics/smile-dental.env");
    expect(w.calls).toContain("vercel");
    expect(w.pushed.find((v) => v.key === "NEXT_PUBLIC_APP_URL")?.type).toBe("plain");
    expect(w.pushed.find((v) => v.key === "SUPABASE_SECRET_KEY")?.type).toBe("encrypted");
    expect(w.pushed.some((v) => v.key === "VERCEL_TOKEN" || v.key === "SUPABASE_ACCESS_TOKEN")).toBe(false);
    expect(Object.keys(w.written).some((p) => p.endsWith(".vercel.env"))).toBe(false);
  });

  it("is safe to run twice: no duplicate clinic, owner, invite or migration; secrets kept", async () => {
    const w = world();
    await runClinicSetup(w.deps, "clinics/smile-dental.env");
    const secretAfterFirst = w.text.match(/CRON_SECRET=(\w+)/)![1];
    const second = await runClinicSetup(w.deps, "clinics/smile-dental.env");
    expect(second.ok).toBe(true);
    expect(second.applied).toEqual([]);
    expect(w.db.tables.clinics?.length).toBe(1);
    expect(w.db.tables.clinic_config?.length).toBe(1);
    expect(w.db.tables.clinic_users?.length).toBe(1);
    expect(w.invites).toBe(1);
    expect(w.text.match(/CRON_SECRET=(\w+)/)![1]).toBe(secretAfterFirst);
  });

  it("does not re-apply migrations that the project already has under other timestamps", async () => {
    const w = world({ appliedMigrations: [{ version: "20261026084908", name: "schema" }, { version: "20261026084915", name: "rls" }] });
    const r = await runClinicSetup(w.deps, "clinics/smile-dental.env");
    expect(r.applied).toEqual([]);
  });

  it("reports a clear error when the invite fails", async () => {
    const w = world();
    (w.deps.createAdmin as any) = () => ({
      from: (t: string) => (w.db.db as any).from(t),
      auth: { admin: { inviteUserByEmail: async () => ({ data: null, error: { message: "already registered" } }) } },
    });
    await expect(runClinicSetup(w.deps, "clinics/smile-dental.env")).rejects.toThrow(/Could not invite manager@smile.co.uk/);
  });
});

describe("applyMigrations", () => {
  it("applies each pending migration and records it with its SQL", async () => {
    const w = world();
    const mgmt = w.deps.mgmt("t");
    const applied = await applyMigrations(w.deps, mgmt, "abcdefghijklmnopqrst");
    expect(applied).toEqual(["schema", "rls"]);
    expect(w.sqlRuns.filter((s) => s.includes("insert into supabase_migrations"))).toHaveLength(2);
  });
});

describe("runMigrateAll", () => {
  it("applies to each clinic and keeps going when one fails", async () => {
    const w = world();
    let n = 0;
    const base = w.deps.mgmt;
    w.deps.mgmt = (token) => {
      const m = base(token);
      return {
        ...m,
        query: async (ref, sql) => {
          if (token === "sbp_bad") throw new Error("boom");
          n += 1;
          return m.query(ref, sql);
        },
      };
    };
    const texts: Record<string, string> = {
      a: "CLINIC_SLUG=a\nSUPABASE_PROJECT_REF=aaaaaaaaaaaaaaaaaaaa\nSUPABASE_ACCESS_TOKEN=sbp_ok\n",
      b: "CLINIC_SLUG=b\nSUPABASE_PROJECT_REF=bbbbbbbbbbbbbbbbbbbb\nSUPABASE_ACCESS_TOKEN=sbp_bad\n",
      c: "CLINIC_SLUG=c\nSUPABASE_PROJECT_REF=cccccccccccccccccccc\n",
    };
    w.deps.files.readFile = async (p) => texts[p]!;
    const r = await runMigrateAll(w.deps, ["a", "b", "c"]);
    expect(r.ok).toBe(false);
    expect(r.results.map((x) => x.ok)).toEqual([true, false, false]);
    expect(n).toBeGreaterThan(0);
  });

  it("dry run makes no calls", async () => {
    const w = world();
    const r = await runMigrateAll(w.deps, ["x"], { dryRun: true });
    expect(r.ok).toBe(true);
    expect(w.sqlRuns).toEqual([]);
  });

  it("handles no clinic files", async () => {
    const w = world();
    expect((await runMigrateAll(w.deps, [])).ok).toBe(true);
  });
});

describe("API clients", () => {
  const res = (status: number, body: unknown) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) }) as Response;

  it("picks new-style keys, falls back to legacy names, errors when missing", () => {
    expect(pickKeys([{ type: "publishable", api_key: "pk" }, { type: "secret", api_key: "sk" }])).toEqual({ publishableKey: "pk", secretKey: "sk" });
    expect(pickKeys([{ name: "anon", api_key: "a" }, { name: "service_role", api_key: "s" }])).toEqual({ publishableKey: "a", secretKey: "s" });
    expect(() => pickKeys([])).toThrow(/publishable and secret/);
  });

  it("sends the Supabase requests with a Bearer token", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const mgmt = createSupabaseMgmt({
      token: "sbp_t",
      fetchImpl: async (url, init) => {
        seen.push({ url: String(url), init: init! });
        return res(200, [{ type: "publishable", api_key: "pk" }, { type: "secret", api_key: "sk" }]);
      },
    });
    await mgmt.getApiKeys("ref");
    await mgmt.query("ref", "select 1");
    await mgmt.patchAuthConfig("ref", { site_url: "x" });
    expect(seen[0]!.url).toBe("https://api.supabase.com/v1/projects/ref/api-keys?reveal=true");
    expect((seen[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer sbp_t");
    expect(seen[1]!.url).toBe("https://api.supabase.com/v1/projects/ref/database/query");
    expect(seen[1]!.init.method).toBe("POST");
    expect(JSON.parse(String(seen[1]!.init.body))).toEqual({ query: "select 1" });
    expect(seen[2]!.init.method).toBe("PATCH");
  });

  it("errors never contain the token", async () => {
    const mgmt = createSupabaseMgmt({ token: "sbp_secret", fetchImpl: async () => res(401, { message: "Unauthorized" }) });
    const err = await mgmt.query("ref", "select 1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiCallError);
    expect((err as Error).message).toContain("401");
    expect((err as Error).message).not.toContain("sbp_secret");
  });

  it("pushes Vercel variables with upsert, team id and both targets", async () => {
    let url = "";
    let body: unknown;
    const vercel = createVercel({
      token: "vt",
      teamId: "team_1",
      fetchImpl: async (u, init) => {
        url = String(u);
        body = JSON.parse(String(init!.body));
        return res(200, { created: [], failed: [] });
      },
    });
    const n = await vercel.pushEnv("prj_1", [{ key: "A", value: "1", type: "plain" }]);
    expect(n).toBe(1);
    expect(url).toBe("https://api.vercel.com/v10/projects/prj_1/env?upsert=true&teamId=team_1");
    expect(body).toEqual([{ key: "A", value: "1", type: "plain", target: ["production", "preview"] }]);
  });

  it("fails when Vercel reports a failed variable", async () => {
    const vercel = createVercel({ token: "vt", fetchImpl: async () => res(200, { failed: [{ error: { key: "B" } }] }) });
    await expect(vercel.pushEnv("p", [{ key: "B", value: "1", type: "plain" }])).rejects.toThrow(/B/);
  });
});
