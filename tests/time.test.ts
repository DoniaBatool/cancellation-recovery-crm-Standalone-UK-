import { describe, expect, it } from "vitest";
import { dateInZone, formatDuration, localToUtc, minutesBetween } from "@/lib/time";

describe("localToUtc (Europe/London)", () => {
  it("uses GMT in winter", () => {
    expect(localToUtc("2027-01-15", "09:30", "Europe/London")?.toISOString()).toBe("2027-01-15T09:30:00.000Z");
  });

  it("uses BST in summer (one hour behind UTC)", () => {
    expect(localToUtc("2027-07-15", "09:30", "Europe/London")?.toISOString()).toBe("2027-07-15T08:30:00.000Z");
  });

  it("handles the day clocks go forward and back", () => {
    expect(localToUtc("2027-03-28", "12:00", "Europe/London")?.toISOString()).toBe("2027-03-28T11:00:00.000Z");
    expect(localToUtc("2027-10-31", "12:00", "Europe/London")?.toISOString()).toBe("2027-10-31T12:00:00.000Z");
  });

  it.each([
    ["2027-02-31", "10:00"],
    ["2027-13-01", "10:00"],
    ["27-01-01", "10:00"],
    ["2027-01-01", "25:00"],
    ["2027-01-01", "9:00"],
    ["", ""],
  ])("rejects %s %s", (d, t) => {
    expect(localToUtc(d, t, "Europe/London")).toBeNull();
  });
});

describe("dateInZone", () => {
  it("shows the London calendar day", () => {
    expect(dateInZone(new Date("2027-07-15T23:30:00Z"), "Europe/London")).toBe("2027-07-16");
    expect(dateInZone(new Date("2027-01-15T23:30:00Z"), "Europe/London")).toBe("2027-01-15");
  });
});

describe("minutesBetween / formatDuration", () => {
  it("counts whole minutes and never goes negative", () => {
    expect(minutesBetween("2027-01-01T10:00:00Z", "2027-01-01T10:05:59Z")).toBe(5);
    expect(minutesBetween("2027-01-01T10:10:00Z", "2027-01-01T10:00:00Z")).toBe(0);
  });

  it.each([
    [0, "just now"],
    [5, "5 min"],
    [60, "1 h"],
    [130, "2 h 10 min"],
    [1440, "1 day"],
    [4320, "3 days"],
  ])("formats %i minutes as %s", (m, text) => {
    expect(formatDuration(m)).toBe(text);
  });
});
