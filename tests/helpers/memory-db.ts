import type { Db } from "@/lib/pipeline";

// A small in-memory stand-in for the Supabase client, with real filtering and updating.
// Unlike fake-db.ts (which records calls), this lets a test run a whole flow and look at the rows after.

type Row = Record<string, unknown>;
type Filter = { column: string; op: "eq" | "neq" | "in" | "is" | "lt" | "lte" | "gt" | "gte"; value: unknown };

export type MemoryDb = { db: Db; tables: Record<string, Row[]>; failOn: (table: string, op: string) => void };

let counter = 0;

// Column defaults the real database would apply on insert.
const DEFAULTS: Record<string, Row> = { waitlist_offers: { response: "pending" } };

const UNIQUE: Record<string, string[]> = { messages: ["provider_id"] };

export function memoryDb(initial: Record<string, Row[]> = {}): MemoryDb {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(initial)) tables[name] = rows.map((r) => ({ ...r }));
  const failures = new Set<string>();

  const matches = (row: Row, filters: Filter[]) =>
    filters.every((f) => {
      const v = row[f.column];
      switch (f.op) {
        case "eq":
          return v === f.value;
        case "neq":
          return v !== f.value;
        case "in":
          return (f.value as unknown[]).includes(v);
        case "is":
          return f.value === null ? v === null || v === undefined : v === f.value;
        case "lt":
          return v != null && new Date(String(v)).getTime() < new Date(String(f.value)).getTime();
        case "lte":
          return v != null && new Date(String(v)).getTime() <= new Date(String(f.value)).getTime();
        case "gt":
          return v != null && new Date(String(v)).getTime() > new Date(String(f.value)).getTime();
        case "gte":
          return v != null && new Date(String(v)).getTime() >= new Date(String(f.value)).getTime();
      }
    });

  function from(table: string) {
    tables[table] ??= [];
    const filters: Filter[] = [];
    let op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
    let payload: unknown;
    let conflict: string[] = [];
    let wantRows = false;

    const run = () => {
      if (failures.has(`${table}:${op}`)) return { data: null, error: { message: `${table} ${op} failed` } };
      const rows = tables[table]!;
      if (op === "select") return { data: rows.filter((r) => matches(r, filters)).map((r) => ({ ...r })), error: null };
      if (op === "insert") {
        const list = (Array.isArray(payload) ? payload : [payload]) as Row[];
        // Unique indexes the real database has (guide §5.1): a repeated provider_id is rejected.
        for (const key of UNIQUE[table] ?? []) {
          for (const r of list) {
            if (r[key] != null && rows.some((x) => x[key] === r[key])) {
              return { data: null, error: { message: `duplicate key value violates unique constraint on ${key}`, code: "23505" } };
            }
          }
        }
        const created = list.map((r) => ({ id: `${table}-${++counter}`, created_at: "2026-10-26T10:00:00Z", ...DEFAULTS[table], ...r }));
        rows.push(...created);
        return { data: wantRows ? created.map((r) => ({ ...r })) : null, error: null };
      }
      if (op === "upsert") {
        const row = payload as Row;
        const existing = rows.find((r) => conflict.every((c) => r[c] === row[c]));
        if (existing) Object.assign(existing, row);
        else rows.push({ ...row });
        return { data: null, error: null };
      }
      const hit = rows.filter((r) => matches(r, filters));
      if (op === "update") {
        for (const r of hit) Object.assign(r, payload as Row);
        return { data: wantRows ? hit.map((r) => ({ ...r })) : null, error: null };
      }
      tables[table] = rows.filter((r) => !hit.includes(r));
      return { data: wantRows ? hit.map((r) => ({ ...r })) : null, error: null };
    };

    const builder: Record<string, unknown> = {
      select: () => {
        wantRows = true;
        return builder;
      },
      insert: (p: unknown) => {
        op = "insert";
        payload = p;
        return builder;
      },
      update: (p: unknown) => {
        op = "update";
        payload = p;
        return builder;
      },
      upsert: (p: unknown, options?: { onConflict?: string }) => {
        op = "upsert";
        payload = p;
        conflict = (options?.onConflict ?? "id").split(",").map((c) => c.trim());
        return builder;
      },
      delete: () => {
        op = "delete";
        return builder;
      },
      order: () => builder,
      limit: () => builder,
      maybeSingle: () => {
        const r = run();
        return Promise.resolve({ data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error });
      },
      single: () => {
        const r = run();
        return Promise.resolve({ data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error });
      },
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject),
    };
    for (const name of ["eq", "neq", "in", "is", "lt", "lte", "gt", "gte"] as const) {
      builder[name] = (column: string, value: unknown) => {
        filters.push({ column, op: name, value });
        return builder;
      };
    }
    return builder;
  }

  return { db: { from } as unknown as Db, tables, failOn: (table, op) => failures.add(`${table}:${op}`) };
}
