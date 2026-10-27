import { describe, expect, it } from "vitest";
import { bucketTrend, computeMetrics, rangeStartDate, type MetricRow, type TrendDay } from "@/lib/metrics";

const TZ = "Europe/London";
const NOW = new Date("2026-10-26T12:00:00Z"); // Monday, GMT

function row(over: Partial<MetricRow> = {}): MetricRow {
  return {
    stage: "cancellation_detected",
    created_at: "2026-10-26T09:00:00Z",
    detected_at: "2026-10-26T09:00:00Z",
    confirmed_at: null,
    expired_at: null,
    revenue_saved: null,
    procedure_type: "cleaning",
    ...over,
  };
}

describe("rangeStartDate", () => {
  it("week = 7 days including today", () => {
    expect(rangeStartDate("week", NOW, TZ)).toBe("2026-10-20");
    expect(rangeStartDate("month", NOW, TZ)).toBe("2026-09-27");
    expect(rangeStartDate("quarter", NOW, TZ)).toBe("2026-07-29");
  });
});

describe("computeMetrics", () => {
  it("returns zeros and nulls for no rows", () => {
    const m = computeMetrics([], "week", NOW, TZ);
    expect(m).toMatchObject({ slots_total: 0, slots_recovered: 0, recovery_rate: null, revenue_saved: 0, avg_fill_time_minutes: null });
    expect(m.trend).toHaveLength(7);
    expect(m.by_stage.slot_recovered).toBe(0);
  });

  it("counts totals, rate (3 dp), revenue, stages and procedures", () => {
    const rows = [
      row({ stage: "slot_recovered", confirmed_at: "2026-10-26T09:30:00Z", revenue_saved: 150 }),
      row({ stage: "slot_recovered", confirmed_at: "2026-10-26T10:00:00Z", revenue_saved: 200, procedure_type: "filling" }),
      row({ stage: "slot_recovered", confirmed_at: "2026-10-26T10:00:00Z", revenue_saved: 150, procedure_type: null }),
      row({ stage: "expired_manual", expired_at: "2026-10-26T11:00:00Z" }),
      row({ stage: "offer_sent" }),
      row({ stage: "offer_sent" }),
      row({ stage: "waiting_staff_approval" }),
    ];
    const m = computeMetrics(rows, "week", NOW, TZ);
    expect(m.slots_total).toBe(7);
    expect(m.slots_recovered).toBe(3);
    expect(m.recovery_rate).toBe(0.429);
    expect(m.revenue_saved).toBe(500);
    expect(m.by_stage).toMatchObject({ slot_recovered: 3, expired_manual: 1, offer_sent: 2, waiting_staff_approval: 1, cancellation_detected: 0 });
    expect(m.by_procedure).toEqual({ cleaning: 1, filling: 1, other: 1 });
  });

  it("average fill time uses detected_at, falling back to created_at, rounded to whole minutes", () => {
    const rows = [
      row({ stage: "slot_recovered", detected_at: "2026-10-26T09:00:00Z", confirmed_at: "2026-10-26T09:10:00Z", revenue_saved: 100 }),
      row({ stage: "slot_recovered", detected_at: null, created_at: "2026-10-26T09:00:00Z", confirmed_at: "2026-10-26T09:25:00Z", revenue_saved: 100 }),
      row({ stage: "slot_recovered", detected_at: "2026-10-26T09:00:00Z", confirmed_at: null, revenue_saved: 100 }), // not counted in the mean
    ];
    expect(computeMetrics(rows, "week", NOW, TZ).avg_fill_time_minutes).toBe(18); // (10 + 25) / 2 = 17.5 -> 18
  });

  it("ignores rows created outside the rolling range (the 19th is still BST: 22:59 UTC = 23:59 London)", () => {
    const rows = [row({ created_at: "2026-10-19T22:59:00Z" }), row({ created_at: "2026-10-19T23:00:00Z" })];
    expect(computeMetrics(rows, "week", NOW, TZ).slots_total).toBe(1);
    expect(computeMetrics(rows, "month", NOW, TZ).slots_total).toBe(2);
  });

  it("trend counts recovered by confirmed_at and expired by expired_at, per clinic-timezone day", () => {
    const rows = [
      row({ stage: "slot_recovered", created_at: "2026-10-22T09:00:00Z", confirmed_at: "2026-10-22T10:00:00Z", revenue_saved: 100 }),
      row({ stage: "expired_manual", created_at: "2026-10-22T09:00:00Z", expired_at: "2026-10-23T08:00:00Z" }),
      row({ stage: "expired_manual", created_at: "2026-10-22T09:00:00Z", expired_at: "2026-10-23T09:00:00Z" }),
    ];
    const trend = computeMetrics(rows, "week", NOW, TZ).trend;
    expect(trend[0]?.date).toBe("2026-10-20");
    expect(trend[6]?.date).toBe("2026-10-26");
    expect(trend.find((d) => d.date === "2026-10-22")).toMatchObject({ recovered: 1, expired: 0 });
    expect(trend.find((d) => d.date === "2026-10-23")).toMatchObject({ recovered: 0, expired: 2 });
  });

  it("uses the clinic day for rows around midnight in summer time", () => {
    const summerNow = new Date("2026-06-29T12:00:00Z");
    const rows = [row({ stage: "slot_recovered", created_at: "2026-06-28T23:30:00Z", confirmed_at: "2026-06-28T23:45:00Z", revenue_saved: 100 })];
    const trend = computeMetrics(rows, "week", summerNow, TZ).trend;
    // 23:45 UTC on the 28th is 00:45 BST on the 29th.
    expect(trend.find((d) => d.date === "2026-06-29")?.recovered).toBe(1);
    expect(trend.find((d) => d.date === "2026-06-28")?.recovered).toBe(0);
  });
});

describe("bucketTrend", () => {
  const make = (days: number): TrendDay[] =>
    Array.from({ length: days }, (_, i) => ({
      date: new Date(Date.UTC(2026, 6, 29 + i)).toISOString().slice(0, 10),
      recovered: i % 3,
      expired: i % 2,
    }));

  it("keeps daily bars up to 31 days", () => {
    expect(bucketTrend(make(31))).toHaveLength(31);
    expect(bucketTrend(make(7))).toHaveLength(7);
  });

  it("groups into weeks beyond 31 days, first bucket may be shorter, totals preserved", () => {
    const trend = make(90);
    const out = bucketTrend(trend);
    expect(out).toHaveLength(13); // 12 full weeks + a first bucket of 6 days
    expect(out[0]?.date).toBe(trend[0]?.date);
    const sum = (list: TrendDay[], key: "recovered" | "expired") => list.reduce((n, d) => n + d[key], 0);
    expect(sum(out, "recovered")).toBe(sum(trend, "recovered"));
    expect(sum(out, "expired")).toBe(sum(trend, "expired"));
    // The last bucket is a full week ending on the last day.
    expect(out.at(-1)?.date).toBe(trend[83]?.date);
  });
});
