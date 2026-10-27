import { describe, expect, it } from "vitest";
import { planWaitlistSync, type SyncInput } from "@/lib/waitlist-sync";

const input = (over: Partial<SyncInput> = {}): SyncInput => ({ pms_patient_id: "P1", patient_name: "Sarah Khan", phone: "+447700900001", email: null, is_active: true, ...over });
const row = (over = {}) => ({ id: "w1", is_active: true, pms_patient_id: "P1", ...over });

describe("planWaitlistSync (guide §6.7)", () => {
  it("no match + active + name and contact -> created", () => {
    expect(planWaitlistSync(input(), null, null)).toEqual({ action: "created" });
  });
  it("no match + inactive -> ignored", () => {
    expect(planWaitlistSync(input({ is_active: false }), null, null)).toEqual({ action: "ignored" });
  });
  it("no match + missing name or contact -> invalid", () => {
    expect(planWaitlistSync(input({ patient_name: " " }), null, null).action).toBe("invalid");
    expect(planWaitlistSync(input({ phone: null, email: null }), null, null).action).toBe("invalid");
    expect(planWaitlistSync(input({ phone: null, email: "a@b.com" }), null, null)).toEqual({ action: "created" });
  });
  it("matched by PMS id -> updated, or deactivated when inactive", () => {
    expect(planWaitlistSync(input(), row(), null)).toEqual({ action: "updated", id: "w1" });
    expect(planWaitlistSync(input({ is_active: false }), row(), null)).toEqual({ action: "deactivated", id: "w1" });
  });
  it("matched only by contact -> linked, or deactivated when inactive", () => {
    const contact = row({ id: "w2", pms_patient_id: null });
    expect(planWaitlistSync(input(), null, contact)).toEqual({ action: "linked", id: "w2" });
    expect(planWaitlistSync(input({ is_active: false }), null, contact)).toEqual({ action: "deactivated", id: "w2" });
  });
  it("the PMS-id match wins over the contact match", () => {
    expect(planWaitlistSync(input(), row({ id: "pms" }), row({ id: "contact", pms_patient_id: null }))).toEqual({ action: "updated", id: "pms" });
  });
});
