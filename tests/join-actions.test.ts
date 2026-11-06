import { beforeEach, describe, expect, it, vi } from "vitest";

// Public sign-up actions with a tiny in-memory fake of the admin client.

type Row = Record<string, unknown>;
const state: { clinics: Row[]; waitlist: Row[]; limited: boolean } = { clinics: [], waitlist: [], limited: false };

function table(name: "clinics" | "waitlist") {
  const filters: Array<[string, unknown]> = [];
  let mode: "select" | "update" | "insert" = "select";
  let patch: Row = {};
  const run = () => {
    const rows = state[name].filter((r) => filters.every(([k, v]) => r[k] === v));
    if (mode === "update") {
      rows.forEach((r) => Object.assign(r, patch));
      return { data: null, error: null };
    }
    return { data: rows, error: null };
  };
  const q: Record<string, unknown> = {
    select: () => q,
    eq: (k: string, v: unknown) => (filters.push([k, v]), q),
    update: (p: Row) => ((mode = "update"), (patch = p), q),
    insert: (p: Row) => {
      state[name].push({ id: `00000000-0000-4000-8000-${String(state[name].length + 1).padStart(12, "0")}`, sms_opt_out: false, ...p });
      return Promise.resolve({ data: null, error: null });
    },
    maybeSingle: () => {
      const { data } = run();
      return Promise.resolve({ data: (data as Row[])[0] ?? null, error: null });
    },
    then: (resolve: (v: unknown) => unknown) => resolve(run()),
  };
  return q;
}

vi.mock("@/lib/supabase/admin", () => ({ getAdminClient: () => ({ from: (n: "clinics" | "waitlist") => table(n) }) }));
vi.mock("@/lib/rate-limit-request", () => ({ isIpRateLimited: async () => state.limited }));

import { answerSmsPreference, joinClinicWaitlist } from "@/app/join/[slug]/actions";

const CLINIC = "11111111-1111-4111-8111-111111111111";
const PATIENT = "22222222-2222-4222-8222-222222222222";

function signupForm() {
  const f = new FormData();
  f.set("patient_name", "Ann Patient");
  f.set("phone", "07700 900001");
  f.set("email", "ann@example.com");
  f.set("max_notice_hours", "24");
  f.set("consent", "on");
  return f;
}

beforeEach(() => {
  state.clinics = [{ id: CLINIC, slug: "smile", is_active: true }];
  state.waitlist = [];
  state.limited = false;
});

describe("joinClinicWaitlist source", () => {
  it("stores 'qr' when the page was opened from the QR code", async () => {
    const r = await joinClinicWaitlist("smile", "qr", null, signupForm());
    expect(r?.message).toBe("joined");
    expect(state.waitlist[0]!.opt_in_source).toBe("qr");
  });

  it("stores 'sms_link' for a plain link or an unknown src", async () => {
    await joinClinicWaitlist("smile", undefined, null, signupForm());
    expect(state.waitlist[0]!.opt_in_source).toBe("sms_link");
    state.waitlist = [];
    await joinClinicWaitlist("smile", "evil", null, signupForm());
    expect(state.waitlist[0]!.opt_in_source).toBe("sms_link");
  });
});

describe("joinClinicWaitlist STOP question", () => {
  it("does not ask a brand-new or normal patient", async () => {
    const r = await joinClinicWaitlist("smile", undefined, null, signupForm());
    expect(r?.askSmsPreference).toBeUndefined();
  });

  it("asks a patient who earlier replied STOP", async () => {
    state.waitlist = [{ id: PATIENT, clinic_id: CLINIC, phone: "+447700900001", email: "ann@example.com", sms_opt_out: true }];
    const r = await joinClinicWaitlist("smile", undefined, null, signupForm());
    expect(r?.message).toBe("joined");
    expect(r?.askSmsPreference).toEqual({ patientId: PATIENT });
    expect(state.waitlist[0]!.sms_opt_out).toBe(true); // sign-up alone does not clear it
  });
});

describe("answerSmsPreference", () => {
  beforeEach(() => {
    state.waitlist = [{ id: PATIENT, clinic_id: CLINIC, sms_opt_out: true, sms_opt_out_at: "2027-01-01T00:00:00Z" }];
  });

  it("yes clears the opt-out", async () => {
    const r = await answerSmsPreference("smile", PATIENT, "yes");
    expect(r.ok).toBe(true);
    expect(state.waitlist[0]!.sms_opt_out).toBe(false);
    expect(state.waitlist[0]!.sms_opt_out_at).toBeNull();
  });

  it("no changes nothing", async () => {
    const r = await answerSmsPreference("smile", PATIENT, "no");
    expect(r.ok).toBe(true);
    expect(state.waitlist[0]!.sms_opt_out).toBe(true);
  });

  it("rejects bad answers, bad ids, other clinics, and patients who are not opted out", async () => {
    expect((await answerSmsPreference("smile", PATIENT, "maybe")).ok).toBe(false);
    expect((await answerSmsPreference("smile", "not-a-uuid", "yes")).ok).toBe(false);
    state.clinics.push({ id: "33333333-3333-4333-8333-333333333333", slug: "other", is_active: true });
    expect((await answerSmsPreference("other", PATIENT, "yes")).ok).toBe(false);
    expect(state.waitlist[0]!.sms_opt_out).toBe(true);
    state.waitlist[0]!.sms_opt_out = false;
    expect((await answerSmsPreference("smile", PATIENT, "yes")).ok).toBe(false);
  });

  it("is rate limited", async () => {
    state.limited = true;
    const r = await answerSmsPreference("smile", PATIENT, "yes");
    expect(r.ok).toBe(false);
    expect(state.waitlist[0]!.sms_opt_out).toBe(true);
  });
});
