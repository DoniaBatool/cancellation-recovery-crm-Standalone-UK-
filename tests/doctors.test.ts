import { describe, expect, it } from "vitest";
import { doctorName, readDoctors } from "@/lib/doctors";
import { isStage } from "@/lib/constants";

describe("readDoctors", () => {
  it("keeps valid entries and drops malformed ones", () => {
    const out = readDoctors([
      { id: "dr-a", name: "Dr A", email: "a@c.co.uk" },
      { id: "dr-b", name: "Dr B" },
      { id: "", name: "No id" },
      { id: "x" },
      null,
      "string",
      { id: "dr-c", name: "Dr C", email: "" },
    ]);
    expect(out).toEqual([
      { id: "dr-a", name: "Dr A", email: "a@c.co.uk" },
      { id: "dr-b", name: "Dr B" },
      { id: "dr-c", name: "Dr C" },
    ]);
  });

  it("returns an empty list for non-arrays", () => {
    expect(readDoctors(null)).toEqual([]);
    expect(readDoctors({})).toEqual([]);
    expect(readDoctors("[]")).toEqual([]);
  });
});

describe("doctorName", () => {
  const doctors = [{ id: "dr-a", name: "Dr A" }];
  it("maps ids to names with sensible fallbacks", () => {
    expect(doctorName(doctors, "dr-a")).toBe("Dr A");
    expect(doctorName(doctors, "gone")).toBe("gone");
    expect(doctorName(doctors, null)).toBe("Any dentist");
  });
});

describe("isStage", () => {
  it("accepts the five stages only", () => {
    expect(isStage("offer_sent")).toBe(true);
    expect(isStage("recovered")).toBe(false);
    expect(isStage(null)).toBe(false);
  });
});
