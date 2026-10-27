import { describe, expect, it } from "vitest";
import { quietHoursResume } from "@/lib/quiet-hours";

const TZ = "Europe/London";
const iso = (d: Date | null) => d?.toISOString() ?? null;

describe("quietHoursResume", () => {
  it("is null outside quiet hours", () => {
    expect(quietHoursResume(new Date("2026-10-26T12:00:00Z"), "20:00:00", "08:00:00", TZ)).toBeNull();
    expect(quietHoursResume(new Date("2026-10-26T08:00:00Z"), "20:00:00", "08:00:00", TZ)).toBeNull(); // end is exclusive
    expect(quietHoursResume(new Date("2026-10-26T19:59:00Z"), "20:00", "08:00", TZ)).toBeNull();
  });

  it("before midnight: resumes the next morning", () => {
    expect(iso(quietHoursResume(new Date("2026-10-26T21:00:00Z"), "20:00:00", "08:00:00", TZ))).toBe("2026-10-27T08:00:00.000Z");
    expect(iso(quietHoursResume(new Date("2026-10-26T20:00:00Z"), "20:00:00", "08:00:00", TZ))).toBe("2026-10-27T08:00:00.000Z");
  });

  it("after midnight: resumes the same morning", () => {
    expect(iso(quietHoursResume(new Date("2026-10-27T02:00:00Z"), "20:00:00", "08:00:00", TZ))).toBe("2026-10-27T08:00:00.000Z");
  });

  it("uses clinic local time in summer (BST = UTC+1)", () => {
    // 19:30 UTC is 20:30 BST: inside. 08:00 BST is 07:00 UTC.
    expect(iso(quietHoursResume(new Date("2026-06-29T19:30:00Z"), "20:00:00", "08:00:00", TZ))).toBe("2026-06-30T07:00:00.000Z");
    expect(quietHoursResume(new Date("2026-06-29T18:30:00Z"), "20:00:00", "08:00:00", TZ)).toBeNull(); // 19:30 BST
  });

  it("handles a same-day window", () => {
    expect(iso(quietHoursResume(new Date("2026-10-26T13:00:00Z"), "12:00", "14:00", TZ))).toBe("2026-10-26T14:00:00.000Z");
    expect(quietHoursResume(new Date("2026-10-26T15:00:00Z"), "12:00", "14:00", TZ)).toBeNull();
  });

  it("equal start and end, or bad input, means no quiet hours", () => {
    expect(quietHoursResume(new Date("2026-10-26T03:00:00Z"), "08:00", "08:00", TZ)).toBeNull();
    expect(quietHoursResume(new Date("2026-10-26T03:00:00Z"), "nope", "08:00", TZ)).toBeNull();
  });
});
