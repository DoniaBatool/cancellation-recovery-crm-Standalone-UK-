import { describe, expect, it } from "vitest";
import {
  hoursUntil,
  matchWaitlist,
  normaliseDoctorName,
  timeOfDayInZone,
  weekdayInZone,
  type Candidate,
  type Slot,
} from "@/lib/waitlist-matching";

const TZ = "Europe/London";
// Monday 2026-10-26 09:30 UTC = 09:30 GMT? No: BST ended 2026-10-25, so London is GMT (UTC+0).
const NOW = new Date("2026-10-26T08:00:00Z");

function patient(over: Partial<Candidate> & { id: string }): Candidate {
  return {
    patient_name: `P ${over.id}`,
    is_active: true,
    sms_opt_out: false,
    phone: "+447700900001",
    email: null,
    max_notice_hours: 0,
    preferred_procedures: [],
    preferred_days: [],
    preferred_times: [],
    preferred_doctors: [],
    last_contacted_at: null,
    ...over,
  };
}

function slot(over: Partial<Slot> = {}): Slot {
  return { datetime: new Date("2026-10-26T14:30:00Z"), procedure: "cleaning", doctor: "Dr Ali Khan", timeZone: TZ, ...over };
}

describe("helpers", () => {
  it("normalises dentist names", () => {
    expect(normaliseDoctorName("  Dr. Ali   Khan ")).toBe("ali khan");
    expect(normaliseDoctorName("DR Ali Khan")).toBe("ali khan");
    expect(normaliseDoctorName("Drew Smith")).toBe("drew smith");
  });

  it("reads weekday and time of day in the clinic timezone, across the BST/GMT change", () => {
    // 23:30 UTC on Saturday 2026-06-27 is already Sunday 00:30 in London (BST).
    expect(weekdayInZone(new Date("2026-06-27T23:30:00Z"), TZ)).toBe("Sunday");
    expect(weekdayInZone(new Date("2026-12-12T23:30:00Z"), TZ)).toBe("Saturday");
    // 11:30 UTC in summer = 12:30 BST = afternoon; in winter it is 11:30 GMT = morning.
    expect(timeOfDayInZone(new Date("2026-06-29T11:30:00Z"), TZ)).toBe("afternoon");
    expect(timeOfDayInZone(new Date("2026-12-14T11:30:00Z"), TZ)).toBe("morning");
    expect(timeOfDayInZone(new Date("2026-12-14T16:59:00Z"), TZ)).toBe("afternoon");
    expect(timeOfDayInZone(new Date("2026-12-14T17:00:00Z"), TZ)).toBe("evening");
  });

  it("hoursUntil is fractional and negative for past slots", () => {
    expect(hoursUntil(new Date("2026-10-26T09:30:00Z"), NOW)).toBe(1.5);
    expect(hoursUntil(new Date("2026-10-26T07:00:00Z"), NOW)).toBe(-1);
  });
});

describe("hard filters", () => {
  it("skips inactive patients and patients with no way to be contacted", () => {
    const out = matchWaitlist(
      [
        patient({ id: "a", is_active: false }),
        patient({ id: "b", phone: null, email: null }),
        patient({ id: "c", sms_opt_out: true, email: null }),
        patient({ id: "d", sms_opt_out: true, email: "d@example.com" }),
        patient({ id: "e", phone: null, email: "e@example.com" }),
      ],
      slot(),
      NOW,
    );
    expect(out.map((m) => m.patient.id).sort()).toEqual(["d", "e"]);
  });

  it("needs at least max_notice_hours before the slot (equal is fine)", () => {
    // Slot is 6.5 h away.
    const out = matchWaitlist(
      [patient({ id: "ok", max_notice_hours: 6 }), patient({ id: "edge", max_notice_hours: 6.5 }), patient({ id: "no", max_notice_hours: 24 })],
      slot(),
      NOW,
    );
    expect(out.map((m) => m.patient.id).sort()).toEqual(["edge", "ok"]);
  });

  it("filters by procedure: empty list, unknown slot procedure and exact match pass; others do not", () => {
    const list = [
      patient({ id: "any" }),
      patient({ id: "exact", preferred_procedures: ["cleaning", "filling"] }),
      patient({ id: "other", preferred_procedures: ["implant"] }),
    ];
    expect(matchWaitlist(list, slot(), NOW).map((m) => m.patient.id).sort()).toEqual(["any", "exact"]);
    expect(matchWaitlist(list, slot({ procedure: null }), NOW).map((m) => m.patient.id).sort()).toEqual(["any", "exact", "other"]);
  });

  it("excludes patients already offered this slot", () => {
    const list = [patient({ id: "a" }), patient({ id: "b" })];
    expect(matchWaitlist(list, slot(), NOW, { excludePatientIds: new Set(["a"]) }).map((m) => m.patient.id)).toEqual(["b"]);
    expect(matchWaitlist(list, slot(), NOW, { excludePatientIds: ["a", "b"] })).toEqual([]);
  });

  it("returns nothing when the slot is in the past", () => {
    expect(matchWaitlist([patient({ id: "a" })], slot({ datetime: new Date("2026-10-26T07:00:00Z") }), NOW)).toEqual([]);
  });
});

describe("score", () => {
  it("base 0.70 exact, 0.50 otherwise, plus 0.10 + 0.10 for empty day and time lists", () => {
    const [exact] = matchWaitlist([patient({ id: "x", preferred_procedures: ["cleaning"] })], slot(), NOW);
    const [any] = matchWaitlist([patient({ id: "y" })], slot(), NOW);
    expect(exact?.score).toBe(0.9);
    expect(any?.score).toBe(0.7);
  });

  it("day and time bonuses use the clinic timezone", () => {
    // Monday 14:30 GMT = afternoon.
    const hit = matchWaitlist([patient({ id: "a", preferred_days: ["Monday"], preferred_times: ["afternoon"] })], slot(), NOW)[0];
    const miss = matchWaitlist([patient({ id: "b", preferred_days: ["Tuesday"], preferred_times: ["morning"] })], slot(), NOW)[0];
    expect(hit?.score).toBe(0.8);
    expect(miss?.score).toBe(0.5);
  });

  it("a slot just after midnight UTC is judged by the London day during BST", () => {
    const summerNow = new Date("2026-06-26T08:00:00Z");
    const s = slot({ datetime: new Date("2026-06-26T23:30:00Z") }); // Saturday 00:30 BST
    const out = matchWaitlist([patient({ id: "sat", preferred_days: ["Saturday"], preferred_times: ["morning"] })], s, summerNow)[0];
    expect(out?.score).toBe(0.8); // 0.5 + 0.15 + 0.15
  });

  it("dentist match: yes +0.10, no -0.15, none or unknown 0", () => {
    const list = [
      patient({ id: "yes", preferred_doctors: ["ali khan"] }),
      patient({ id: "no", preferred_doctors: ["Dr Sara Lee"] }),
      patient({ id: "any" }),
    ];
    const byId = Object.fromEntries(matchWaitlist(list, slot(), NOW).map((m) => [m.patient.id, m]));
    expect(byId.yes).toMatchObject({ score: 0.8, preferredDoctorMatch: "yes" });
    expect(byId.no).toMatchObject({ score: 0.55, preferredDoctorMatch: "no" });
    expect(byId.any).toMatchObject({ score: 0.7, preferredDoctorMatch: "any" });
    const unknown = matchWaitlist([patient({ id: "u", preferred_doctors: ["Dr Sara Lee"] })], slot({ doctor: null }), NOW)[0];
    expect(unknown).toMatchObject({ score: 0.7, preferredDoctorMatch: "any" });
  });

  it("rounds to two decimals", () => {
    const out = matchWaitlist([patient({ id: "r", preferred_doctors: ["Dr Sara Lee"], preferred_days: ["Monday"] })], slot(), NOW)[0];
    expect(out?.score).toBe(0.6); // 0.5 + 0.15 + 0.10 - 0.15
  });
});

describe("sort", () => {
  it("highest score first", () => {
    const out = matchWaitlist(
      [patient({ id: "low", preferred_days: ["Friday"] }), patient({ id: "high", preferred_procedures: ["cleaning"] })],
      slot(),
      NOW,
    );
    expect(out.map((m) => m.patient.id)).toEqual(["high", "low"]);
  });

  it("ties: never contacted first, then least recently contacted", () => {
    const out = matchWaitlist(
      [
        patient({ id: "recent", last_contacted_at: "2026-10-25T10:00:00Z" }),
        patient({ id: "old", last_contacted_at: "2026-10-01T10:00:00Z" }),
        patient({ id: "never", last_contacted_at: null }),
      ],
      slot(),
      NOW,
    );
    expect(out.map((m) => m.patient.id)).toEqual(["never", "old", "recent"]);
  });
});
