import { describe, expect, it } from "vitest";
import { addManager, createClinic, generatePassword, slugify } from "../scripts/lib/clinic-admin.mjs";

type Row = Record<string, unknown>;

/** Tiny fake of the Supabase admin client: tables with eq filters, plus auth.admin. */
function fakeDb(opts: { users?: Array<{ id: string; email: string }>; clinics?: Row[]; ownerExists?: boolean; configFails?: boolean } = {}) {
  const tables: Record<string, Row[]> = { clinics: [...(opts.clinics ?? [])], clinic_config: [], clinic_users: [] };
  const users = [...(opts.users ?? [])];
  const sent: string[] = [];
  const created: string[] = [];

  const from = (name: string) => {
    const filters: Array<[string, unknown]> = [];
    let mode: "select" | "insert" | "delete" | "upsert" = "select";
    let payload: Row = {};
    const run = (): { data: unknown; error: unknown } => {
      const rows = tables[name]!.filter((r) => filters.every(([k, v]) => r[k] === v));
      if (mode === "delete") {
        tables[name] = tables[name]!.filter((r) => !rows.includes(r));
        return { data: null, error: null };
      }
      return { data: rows, error: null };
    };
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (k: string, v: unknown) => (filters.push([k, v]), q),
      delete: () => ((mode = "delete"), q),
      insert: (p: Row) => {
        mode = "insert";
        payload = p;
        if (name === "clinics" && tables.clinics!.some((c) => c.slug === p.slug)) return Object.assign(q, { _result: { data: null, error: { code: "23505", message: "duplicate" } } });
        if (name === "clinic_config" && opts.configFails) return Object.assign(q, { _result: { data: null, error: { message: "boom" } } });
        const row = { id: `id-${tables[name]!.length + 1}`, ...p };
        tables[name]!.push(row);
        return Object.assign(q, { _result: { data: row, error: null } });
      },
      upsert: (p: Row) => {
        if (opts.ownerExists && p.role === "owner") return Promise.resolve({ error: { code: "23505", message: "dup owner" } });
        tables[name]!.push(p);
        return Promise.resolve({ error: null });
      },
      single: () => Promise.resolve((q as { _result: unknown })._result),
      maybeSingle: () => Promise.resolve({ data: (run().data as Row[])[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown) => resolve((q as { _result?: unknown })._result ?? run()),
    };
    return q;
  };

  const auth = {
    admin: {
      listUsers: async () => ({ data: { users }, error: null }),
      createUser: async ({ email }: { email: string }) => {
        created.push(email);
        const user = { id: `u-${users.length + 1}`, email };
        users.push(user);
        return { data: { user }, error: null };
      },
      inviteUserByEmail: async (email: string, o: { redirectTo: string }) => {
        sent.push(`${email} ${o.redirectTo}`);
        const user = { id: `u-${users.length + 1}`, email };
        users.push(user);
        return { data: { user }, error: null };
      },
    },
  };
  return { db: { from, auth }, tables, sent, created };
}

describe("slugify", () => {
  it("makes a url-safe slug", () => {
    expect(slugify("Smile Dental, London")).toBe("smile-dental-london");
    expect(slugify("Café & Co. Dental")).toBe("cafe-and-co-dental");
    expect(slugify("  --Hello--  ")).toBe("hello");
  });

  it("caps the length", () => {
    expect(slugify("a".repeat(100)).length).toBe(60);
  });
});

describe("generatePassword", () => {
  it("is long and different each time", () => {
    const a = generatePassword();
    expect(a.length).toBeGreaterThanOrEqual(16);
    expect(a).not.toBe(generatePassword());
  });
});

describe("createClinic", () => {
  it("creates the clinic and its settings row", async () => {
    const w = fakeDb();
    const clinic = await createClinic(w.db, { name: "Smile Dental, London", email: "r@smile.co.uk" });
    expect(clinic.slug).toBe("smile-dental-london");
    expect(w.tables.clinics).toHaveLength(1);
    expect(w.tables.clinic_config).toHaveLength(1);
    expect(w.tables.clinics![0]).toMatchObject({ timezone: "Europe/London", contact_email: "r@smile.co.uk" });
  });

  it("needs a name and a clean slug", async () => {
    const w = fakeDb();
    await expect(createClinic(w.db, {})).rejects.toThrow(/--name/);
    await expect(createClinic(w.db, { name: "X", slug: "Bad Slug!" })).rejects.toThrow(/slug/);
  });

  it("explains a duplicate slug", async () => {
    const w = fakeDb({ clinics: [{ id: "c1", slug: "smile-dental", name: "Smile" }] });
    await expect(createClinic(w.db, { name: "Smile Dental" })).rejects.toThrow(/already exists/);
  });

  it("removes the clinic again if the settings row cannot be created", async () => {
    const w = fakeDb({ configFails: true });
    await expect(createClinic(w.db, { name: "Smile Dental" })).rejects.toThrow(/settings/);
    expect(w.tables.clinics).toHaveLength(0);
  });
});

describe("addManager", () => {
  const clinics = [{ id: "c1", slug: "smile", name: "Smile Dental" }];

  it("emails an invite to a new login and links it", async () => {
    const w = fakeDb({ clinics });
    const out = await addManager(w.db, { clinic: "smile", email: "PM@Smile.co.uk", role: "owner" }, { appUrl: "https://app.smile.co.uk/" });
    expect(out).toContain("pm@smile.co.uk -> Smile Dental (owner)");
    expect(w.sent[0]).toBe("pm@smile.co.uk https://app.smile.co.uk/auth/confirm?next=/set-password");
    expect(w.tables.clinic_users![0]).toMatchObject({ clinic_id: "c1", role: "owner" });
  });

  it("creates a login with a one-time password when asked", async () => {
    const w = fakeDb({ clinics });
    const out = await addManager(w.db, { clinic: "smile", email: "a@smile.co.uk", withPassword: true });
    expect(out).toContain("one-time password:");
    expect(w.created).toEqual(["a@smile.co.uk"]);
    expect(w.sent).toHaveLength(0);
  });

  it("just links an existing login and sends nothing", async () => {
    const w = fakeDb({ clinics, users: [{ id: "u-9", email: "a@smile.co.uk" }] });
    const out = await addManager(w.db, { clinic: "smile", email: "a@smile.co.uk" });
    expect(out).toContain("nothing sent");
    expect(w.sent).toHaveLength(0);
    expect(w.tables.clinic_users![0]).toMatchObject({ user_id: "u-9", role: "staff" });
  });

  it("rejects missing options, bad roles and unknown clinics", async () => {
    const w = fakeDb({ clinics });
    await expect(addManager(w.db, { email: "a@b.co" })).rejects.toThrow(/required/);
    await expect(addManager(w.db, { clinic: "smile", email: "a@b.co", role: "boss" })).rejects.toThrow(/--role/);
    await expect(addManager(w.db, { clinic: "nope", email: "a@b.co" })).rejects.toThrow(/no clinic/);
  });

  it("explains when the clinic already has an owner", async () => {
    const w = fakeDb({ clinics, ownerExists: true });
    await expect(addManager(w.db, { clinic: "smile", email: "x@smile.co.uk", role: "owner" })).rejects.toThrow(/already has an owner/);
  });
});
