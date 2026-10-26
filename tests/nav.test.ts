import { describe, expect, it } from "vitest";
import { NAV_ITEMS, isActive } from "@/components/shell/nav-items";

describe("navigation (guide §9)", () => {
  it("lists the six items in order", () => {
    expect(NAV_ITEMS.map((i) => i.label)).toEqual(["Dashboard", "Pipeline", "Waitlist", "Activity", "Settings", "Team"]);
  });

  it("highlights the matching page only", () => {
    expect(isActive("/dashboard", "/dashboard")).toBe(true);
    expect(isActive("/crm", "/crm")).toBe(true);
    expect(isActive("/crm/waitlist", "/crm/waitlist")).toBe(true);
    expect(isActive("/crm/config/qr-card", "/crm/config")).toBe(true);
  });

  it("does not highlight Pipeline on the other /crm pages, but does on a patient page", () => {
    expect(isActive("/crm/waitlist", "/crm")).toBe(false);
    expect(isActive("/crm/team", "/crm")).toBe(false);
    expect(isActive("/crm/patient/123", "/crm")).toBe(true);
  });

  it("does not match a longer path that only shares a prefix", () => {
    expect(isActive("/dashboards", "/dashboard")).toBe(false);
  });
});
