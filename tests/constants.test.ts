import { describe, expect, it } from "vitest";
import {
  ALLOWED_TRANSITIONS,
  DEFAULT_RANGE,
  RANGES,
  STAGES,
  STAGE_HINTS,
  STAGE_LABELS,
  STAGE_SHORT_LABELS,
  STAGE_TIMESTAMP,
  STAGE_TONES,
  isRole,
  parseRange,
} from "@/lib/constants";

describe("stages (guide §6.1)", () => {
  it("has the five stages in board order", () => {
    expect(STAGES).toEqual([
      "cancellation_detected",
      "offer_sent",
      "waiting_staff_approval",
      "slot_recovered",
      "expired_manual",
    ]);
  });

  it("has a label, short label and tone for every stage", () => {
    for (const s of STAGES) {
      expect(STAGE_LABELS[s]).toBeTruthy();
      expect(STAGE_SHORT_LABELS[s]).toBeTruthy();
      expect(STAGE_TONES[s]).toBeTruthy();
    }
  });

  it("uses the tones from the guide (grey, blue, amber, green, red)", () => {
    expect(STAGE_TONES).toEqual({
      cancellation_detected: "neutral",
      offer_sent: "info",
      waiting_staff_approval: "warning",
      slot_recovered: "success",
      expired_manual: "destructive",
    });
  });

  it("explains the awaiting-approval column", () => {
    expect(STAGE_HINTS.waiting_staff_approval).toBe(
      "The patient accepted the offer. Approve to confirm; then book it in Dentally.",
    );
  });
});

describe("ALLOWED_TRANSITIONS", () => {
  it("has no way out of the two final stages", () => {
    expect(ALLOWED_TRANSITIONS.slot_recovered).toEqual([]);
    expect(ALLOWED_TRANSITIONS.expired_manual).toEqual([]);
  });

  it("only points at real stages and never backwards to 'detected'", () => {
    for (const from of STAGES) {
      for (const to of ALLOWED_TRANSITIONS[from]) {
        expect(STAGES).toContain(to);
        expect(to).not.toBe("cancellation_detected");
      }
    }
  });

  it("lets 'offer_sent' go to itself (offer the next patient)", () => {
    expect(ALLOWED_TRANSITIONS.offer_sent).toContain("offer_sent");
  });

  it("lets a declined approval go back to 'offer_sent'", () => {
    expect(ALLOWED_TRANSITIONS.waiting_staff_approval).toContain("offer_sent");
  });

  it("lets a detected cancellation go to any later stage (manual flows, guide §6.1)", () => {
    expect(ALLOWED_TRANSITIONS.cancellation_detected).toEqual([
      "offer_sent",
      "waiting_staff_approval",
      "slot_recovered",
      "expired_manual",
    ]);
  });

  it("maps every stage that stamps a time to a column name", () => {
    expect(STAGE_TIMESTAMP).toEqual({
      offer_sent: "offer_sent_at",
      waiting_staff_approval: "approval_requested_at",
      slot_recovered: "confirmed_at",
      expired_manual: "expired_at",
    });
  });
});

describe("isRole", () => {
  it("accepts the three team roles", () => {
    for (const r of ["owner", "admin", "staff"]) expect(isRole(r)).toBe(true);
  });

  it("rejects anything else, including non-strings", () => {
    for (const bad of ["Owner", "superadmin", "", null, undefined, 1, {}]) expect(isRole(bad)).toBe(false);
  });
});

describe("parseRange", () => {
  it("accepts the three ranges", () => {
    for (const r of RANGES) expect(parseRange(r)).toBe(r);
  });

  it("falls back to the default for anything else", () => {
    for (const bad of [undefined, null, "", "year", "WEEK", "week; drop table"]) {
      expect(parseRange(bad as string | null | undefined)).toBe(DEFAULT_RANGE);
    }
    expect(DEFAULT_RANGE).toBe("week");
  });

  it("uses the first value of a repeated query param", () => {
    expect(parseRange(["quarter", "week"])).toBe("quarter");
    expect(parseRange([])).toBe(DEFAULT_RANGE);
  });
});
