import { describe, expect, it } from "vitest";
import { toMetricRows, toRecentRecoveries } from "@/lib/dashboard-data";

describe("toMetricRows", () => {
  const base = { stage: "slot_recovered", created_at: "2026-10-26T10:00:00Z", detected_at: null, confirmed_at: null, expired_at: null, revenue_saved: 100 };
  it("reads the procedure from an object or a one-item array", () => {
    const rows = toMetricRows([
      { ...base, cancellation_events: { procedure_type: "filling" } },
      { ...base, cancellation_events: [{ procedure_type: "crown" }] },
      { ...base, cancellation_events: null },
      { ...base, cancellation_events: [] },
    ]);
    expect(rows.map((r) => r.procedure_type)).toEqual(["filling", "crown", null, null]);
  });
});

describe("toRecentRecoveries", () => {
  it("maps patient, slot and revenue, with safe fallbacks", () => {
    const out = toRecentRecoveries([
      { id: "1", revenue_saved: 120, confirmed_at: "x", waitlist: { patient_name: "Sarah Khan" }, cancellation_events: { slot_datetime: "2026-10-27T14:30:00Z", procedure_type: "filling" } },
      { id: "2", revenue_saved: null, confirmed_at: null, waitlist: null, cancellation_events: null },
    ]);
    expect(out[0]).toEqual({ id: "1", patientName: "Sarah Khan", slotIso: "2026-10-27T14:30:00Z", procedure: "filling", revenue: 120 });
    expect(out[1]).toEqual({ id: "2", patientName: "Patient removed", slotIso: null, procedure: null, revenue: 0 });
  });
});
