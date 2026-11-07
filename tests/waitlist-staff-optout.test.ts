import { beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { memoryDb } from "./helpers/memory-db";

// Staff "add / edit patient" with a tiny in-memory Supabase client.
const ctx: { supabase: ReturnType<typeof memoryDb>["db"] | null } = { supabase: null };
vi.mock("@/lib/staff-session", () => ({
  SIGN_IN_AGAIN: { error: "Your session has ended. Please sign in again." },
  getStaffContext: async () => ({ supabase: ctx.supabase, clinic: { id: "c1" }, actorLabel: "reception@clinic.co.uk" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { saveWaitlistPatient } from "@/app/(app)/crm/waitlist/actions";

const EDIT_ID = "33333333-3333-4333-8333-333333333333";
const STOPPED_AT = "2026-09-01T10:00:00.000Z";
const row = (id: string, over: Record<string, unknown> = {}) => ({
  id, clinic_id: "c1", patient_name: `P ${id}`, email: null, phone: "+447700900001", sms_opt_out: false, sms_opt_out_at: null, is_active: true, ...over,
});
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  f.set("patient_name", "Ann Patient");
  f.set("max_notice_hours", "24");
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
let store: ReturnType<typeof memoryDb>;
const setup = (rows: Record<string, unknown>[]) => {
  store = memoryDb({ waitlist: rows });
  ctx.supabase = store.db;
};

describe("staff re-adds a patient whose number opted out earlier", () => {
  beforeEach(() => setup([row("old", { sms_opt_out: true, sms_opt_out_at: STOPPED_AT, is_active: false })]));

  it("creates the row, but opted out (flag + original date), and shows the note", async () => {
    const result = await saveWaitlistPatient(null, form({ phone: "07700 900001" }));
    expect(result).toMatchObject({ message: "Patient added.", smsOptedOutNote: "This patient opted out earlier. They will not get SMS until they reply START." });
    const created = store.tables.waitlist!.find((r) => r.id !== "old")!;
    expect(created).toMatchObject({ phone: "+447700900001", sms_opt_out: true, sms_opt_out_at: STOPPED_AT, opt_in_source: "receptionist" });
  });

  it("a different number is added normally, with no note", async () => {
    const result = await saveWaitlistPatient(null, form({ phone: "07700 900002" }));
    expect(result).toEqual({ message: "Patient added." });
    expect(store.tables.waitlist!.find((r) => r.id !== "old")!.sms_opt_out).not.toBe(true);
  });

  it("an email-only patient is added normally", async () => {
    expect(await saveWaitlistPatient(null, form({ email: "ann@example.com" }))).toEqual({ message: "Patient added." });
  });

  it("editing a row to the opted-out number also marks it opted out", async () => {
    store.tables.waitlist!.push(row(EDIT_ID, { phone: "+447700900002" }));
    const result = await saveWaitlistPatient(null, form({ id: EDIT_ID, phone: "07700 900001" }));
    expect(result).toMatchObject({ smsOptedOutNote: expect.any(String) });
    expect(store.tables.waitlist!.find((r) => r.id === EDIT_ID)).toMatchObject({ sms_opt_out: true, sms_opt_out_at: STOPPED_AT });
  });
});

describe("staff cannot clear the opt-out", () => {
  it("saving an opted-out patient keeps the flag, even if the form is forged with sms_opt_out=false", async () => {
    setup([row(EDIT_ID, { sms_opt_out: true, sms_opt_out_at: STOPPED_AT })]);
    await saveWaitlistPatient(null, form({ id: EDIT_ID, phone: "07700 900001", sms_opt_out: "false", sms_opt_out_at: "" }));
    expect(store.tables.waitlist!.find((r) => r.id === EDIT_ID)).toMatchObject({ sms_opt_out: true, sms_opt_out_at: STOPPED_AT });
  });

  it("changing an opted-out patient's phone keeps the flag too", async () => {
    setup([row(EDIT_ID, { sms_opt_out: true, sms_opt_out_at: STOPPED_AT })]);
    await saveWaitlistPatient(null, form({ id: EDIT_ID, phone: "07700 900005" }));
    expect(store.tables.waitlist!.find((r) => r.id === EDIT_ID)!.sms_opt_out).toBe(true);
  });

  it("no staff-facing code writes sms_opt_out = false: only the patient path does (START / answerSmsPreference)", () => {
    const root = path.resolve(import.meta.dirname, "..");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(name)) files.push(full);
      }
    };
    walk(path.join(root, "app"));
    walk(path.join(root, "lib"));
    const writers = files
      .filter((f) => /sms_opt_out\s*:\s*false/.test(readFileSync(f, "utf8")))
      .map((f) => path.relative(root, f).split(path.sep).join("/"))
      .sort();
    // join/[slug]/actions.ts = the patient's own "yes, text me again" after signing up (public, no login)
    // lib/engine/inbound-sms.ts = the patient's own START reply
    expect(writers).toEqual(["app/join/[slug]/actions.ts", "lib/engine/inbound-sms.ts"]);
    expect(files.some((f) => f.includes(`${path.sep}crm${path.sep}`) && /sms_opt_out\s*:\s*false/.test(readFileSync(f, "utf8")))).toBe(false);
  });
});
