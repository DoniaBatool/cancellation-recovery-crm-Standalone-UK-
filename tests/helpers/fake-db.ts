import type { Db } from "@/lib/pipeline";

// A tiny chainable stand-in for the Supabase client. Tests describe what each
// table operation should return; every call is recorded in `calls`.

export type Op = "select" | "insert" | "update" | "delete";
export type Result = { data: unknown; error: { message: string } | null };
export type Call = { table: string; op: Op; payload?: unknown; filters: Array<[string, unknown]> };
export type Handler = (call: Call) => Result;

export function fakeDb(handler: Handler) {
  const calls: Call[] = [];

  function from(table: string) {
    const call: Call = { table, op: "select", filters: [] };
    const builder: Record<string, unknown> = {};
    const finish = () => {
      calls.push(call);
      return handler(call);
    };
    builder.select = () => builder; // keeps the op set by insert/update/delete
    builder.insert = (payload: unknown) => {
      call.op = "insert";
      call.payload = payload;
      return builder;
    };
    builder.update = (payload: unknown) => {
      call.op = "update";
      call.payload = payload;
      return builder;
    };
    builder.delete = () => {
      call.op = "delete";
      return builder;
    };
    builder.eq = (column: string, value: unknown) => {
      call.filters.push([column, value]);
      return builder;
    };
    builder.maybeSingle = () => Promise.resolve(finish());
    builder.single = () => Promise.resolve(finish());
    builder.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(finish()).then(resolve, reject);
    return builder;
  }

  return { db: { from } as unknown as Db, calls };
}

export const ok = (data: unknown = null): Result => ({ data, error: null });
export const fail = (message = "boom"): Result => ({ data: null, error: { message } });
