import { describe, expect, it } from "vitest";
import {
  addMonths,
  computeMonthlyReport,
  currentMonth,
  isMonthClosed,
  loadMonthlyReport,
  parseMonth,
  recentMonths,
  reportProcedureLabel,
  type MonthlyReportData,
  type ReportPipelineRow,
} from "@/lib/reports";

const TZ = "Europe/London";
const NOW = new Date("2026-10-29T12:00:00Z");

function row(o: Partial<ReportPipelineRow>): ReportPipelineRow {
  return {
    stage: "cancellation_detected",
    revenue_saved: null,
    created_at: "2026-09-10T09:00:00Z",
    detected_at: "2026-09-10T09:00:00Z",
    offer_sent_at: null,
    confirmed_at: null,
    procedure_type: "cleaning",
    ...o,
  };
}

describe("computeMonthlyReport", () => {
  const rows = [
    row({ stage: "slot_recovered", revenue_saved: 150, offer_sent_at: "2026-09-10T09:05:00Z", confirmed_at: "2026-09-10T09:35:00Z" }),
    row({
      stage: "slot_recovered",
      revenue_saved: 250,
      procedure_type: "filling",
      offer_sent_at: "2026-09-12T09:05:00Z",
      detected_at: "2026-09-12T09:00:00Z",
      created_at: "2026-09-12T09:00:00Z",
      confirmed_at: "2026-09-12T10:05:00Z",
    }),
    row({ stage: "expired_manual", offer_sent_at: "2026-09-15T09:05:00Z" }),
    row({ stage: "offer_sent", offer_sent_at: "2026-09-20T09:05:00Z" }),
    row({}),
    // other months, must be ignored (incl. the UK-midnight edge: 30 Sep 23:30Z is 1 Oct in London)
    row({ detected_at: "2026-08-31T10:00:00Z", created_at: "2026-08-31T10:00:00Z" }),
    row({ detected_at: "2026-09-30T23:30:00Z", created_at: "2026-09-30T23:30:00Z" }),
  ];
  const r = computeMonthlyReport(rows, "2026-09", "Smile Clinic", TZ, NOW);

  it("counts gaps, offers, filled, expired and open for the month only", () => {
    expect(r.gaps).toBe(5);
    expect(r.offers_sent).toBe(4);
    expect(r.filled).toBe(2);
    expect(r.expired).toBe(1);
    expect(r.still_open).toBe(2);
  });

  it("computes fill rate, revenue and average fill time", () => {
    expect(r.fill_rate).toBe(0.4);
    expect(r.revenue_recovered).toBe(400);
    expect(r.avg_fill_minutes).toBe(50); // (35 + 65) / 2
  });

  it("breaks down by procedure, best first", () => {
    expect(r.by_procedure[0]).toMatchObject({ procedure: "cleaning", gaps: 4, filled: 1, revenue: 150 });
    expect(r.by_procedure[1]).toMatchObject({ procedure: "filling", gaps: 1, filled: 1, revenue: 250 });
  });

  it("handles an empty month", () => {
    const empty = computeMonthlyReport([], "2026-09", "X", TZ, NOW);
    expect(empty).toMatchObject({ gaps: 0, fill_rate: 0, revenue_recovered: 0, avg_fill_minutes: null, by_procedure: [] });
  });

  it("groups cancellations with no treatment as 'unknown' and labels them", () => {
    const withNone = computeMonthlyReport([row({ procedure_type: null })], "2026-09", "X", TZ, NOW);
    expect(withNone.by_procedure[0]?.procedure).toBe("unknown");
    expect(reportProcedureLabel("unknown")).toBe("Not specified");
    expect(reportProcedureLabel("crown")).toBe("Crown");
  });

  it("uses created_at when detected_at is missing and never returns a negative fill time", () => {
    const odd = computeMonthlyReport(
      [row({ detected_at: null, stage: "slot_recovered", revenue_saved: 100, confirmed_at: "2026-09-10T08:00:00Z" })],
      "2026-09",
      "X",
      TZ,
      NOW,
    );
    expect(odd.gaps).toBe(1);
    expect(odd.avg_fill_minutes).toBe(0);
  });
});

describe("month helpers", () => {
  it("adds months across years", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-11", 2)).toBe("2027-01");
  });

  it("parses and falls back", () => {
    expect(parseMonth("2026-09", "x")).toBe("2026-09");
    expect(parseMonth("2026-13", "x")).toBe("x");
    expect(parseMonth(undefined, "x")).toBe("x");
    expect(parseMonth(["2026-09"], "x")).toBe("x");
  });

  it("knows the current and closed months", () => {
    expect(currentMonth(TZ, NOW)).toBe("2026-10");
    expect(isMonthClosed("2026-09", TZ, NOW)).toBe(true);
    expect(isMonthClosed("2026-10", TZ, NOW)).toBe(false);
    expect(recentMonths(TZ, 3, NOW)).toEqual(["2026-10", "2026-09", "2026-08"]);
  });
});

// A tiny fake of the two tables loadMonthlyReport touches.
function fakeDb(stored: MonthlyReportData | null, pipelines: Array<Record<string, unknown>>) {
  const upserts: unknown[] = [];
  const db = {
    upserts,
    from(table: string) {
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        gte: () => q,
        lt: () => q,
        limit: () => q,
        order: () => q,
        maybeSingle: () => Promise.resolve({ data: stored ? { data: stored } : null, error: null }),
        upsert: (v: unknown) => {
          upserts.push(v);
          return Promise.resolve({ error: null });
        },
        then: (resolve: (v: unknown) => unknown) => resolve({ data: table === "recovery_pipeline" ? pipelines : [], error: null }),
      };
      return q;
    },
  };
  return db;
}

describe("loadMonthlyReport", () => {
  const clinic = { id: "c1", name: "Smile Clinic", timezone: TZ };
  const pipeline = {
    stage: "slot_recovered",
    revenue_saved: 150,
    created_at: "2026-09-10T09:00:00Z",
    detected_at: "2026-09-10T09:00:00Z",
    offer_sent_at: "2026-09-10T09:05:00Z",
    confirmed_at: "2026-09-10T09:35:00Z",
    cancellation_events: { procedure_type: "cleaning" },
  };

  it("builds and saves a closed month the first time", async () => {
    const db = fakeDb(null, [pipeline]);
    const r = await loadMonthlyReport(db as never, clinic, "2026-09", NOW);
    expect(r.saved).toBe(true);
    expect(r.data.revenue_recovered).toBe(150);
    expect(db.upserts).toHaveLength(1);
  });

  it("returns the frozen snapshot for a closed month and does not rebuild", async () => {
    const frozen = computeMonthlyReport([], "2026-09", "Smile Clinic", TZ, NOW);
    const db = fakeDb(frozen, [pipeline]);
    const r = await loadMonthlyReport(db as never, clinic, "2026-09", NOW);
    expect(r).toEqual({ data: frozen, saved: true });
    expect(db.upserts).toHaveLength(0);
  });

  it("keeps the running month live and unsaved", async () => {
    const db = fakeDb(null, []);
    const r = await loadMonthlyReport(db as never, clinic, "2026-10", NOW);
    expect(r.saved).toBe(false);
    expect(db.upserts).toHaveLength(0);
  });
});
