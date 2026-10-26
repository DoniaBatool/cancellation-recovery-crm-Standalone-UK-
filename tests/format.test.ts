import { describe, expect, it } from "vitest";
import { formatGBP, formatPercent, formatSlot, formatTime } from "@/lib/format";

describe("formatSlot / formatTime (Europe/London)", () => {
  it("shows British Summer Time in summer (UTC+1)", () => {
    // 13:30 UTC on Tue 14 Oct 2025 is 14:30 in London (BST).
    expect(formatSlot("2025-10-14T13:30:00Z")).toBe("Tue 14 Oct, 14:30");
    expect(formatTime("2025-10-14T13:30:00Z")).toBe("14:30");
  });

  it("shows GMT in winter (UTC+0)", () => {
    expect(formatSlot("2026-01-13T09:05:00Z")).toBe("Tue 13 Jan, 09:05");
  });

  it("handles the clocks changing", () => {
    expect(formatTime("2026-03-29T00:30:00Z")).toBe("00:30"); // still GMT
    expect(formatTime("2026-03-29T01:30:00Z")).toBe("02:30"); // BST starts at 01:00 UTC
  });

  it("accepts Date and epoch input and a custom timezone", () => {
    const d = new Date("2025-10-14T13:30:00Z");
    expect(formatTime(d)).toBe("14:30");
    expect(formatTime(d.getTime())).toBe("14:30");
    expect(formatTime(d, "UTC")).toBe("13:30");
  });
});

describe("formatGBP", () => {
  it("formats whole pounds", () => {
    expect(formatGBP(0)).toBe("£0");
    expect(formatGBP(150)).toBe("£150");
    expect(formatGBP(1250)).toBe("£1,250");
  });
});

describe("formatPercent", () => {
  it("rounds to a whole percent", () => {
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(0.4286)).toBe("43%");
    expect(formatPercent(1)).toBe("100%");
  });
});
