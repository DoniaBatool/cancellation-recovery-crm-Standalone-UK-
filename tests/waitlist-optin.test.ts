import { describe, expect, it } from "vitest";
import { planOptIn } from "@/lib/waitlist-optin";

const rows = [
  { id: "1", email: "ann@example.com", phone: "+447700900001" },
  { id: "2", email: null, phone: "+447700900002" },
  { id: "3", email: "bob@example.com", phone: null },
];

describe("planOptIn", () => {
  it("updates the row with the same phone", () => {
    expect(planOptIn(rows, { phone: "+447700900002", email: null })).toEqual({ action: "update", id: "2" });
  });

  it("updates the row with the same email, ignoring case and spaces", () => {
    expect(planOptIn(rows, { phone: null, email: "  BOB@Example.com " })).toEqual({ action: "update", id: "3" });
  });

  it("phone match wins over an email match on another row", () => {
    expect(planOptIn(rows, { phone: "+447700900001", email: "bob@example.com" })).toEqual({ action: "update", id: "1" });
  });

  it("inserts when nothing matches or there is nothing to match", () => {
    expect(planOptIn(rows, { phone: "+447700900009", email: "new@example.com" })).toEqual({ action: "insert" });
    expect(planOptIn([], { phone: null, email: null })).toEqual({ action: "insert" });
  });
});
