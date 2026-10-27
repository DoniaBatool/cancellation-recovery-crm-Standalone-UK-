// Dashboard metrics. Source: SYSTEM_BUILD_GUIDE.md §6.9. Pure: pass `now` in.
// Ranges are rolling: week = 7, month = 30, quarter = 90 days, including today (clinic timezone).

import { RANGE_DAYS, STAGES, type Range, type Stage } from "@/lib/constants";
import { addDaysToDate as addDays, dateInZone } from "@/lib/time";

export type MetricRow = {
  stage: Stage | string;
  created_at: string;
  detected_at: string | null;
  confirmed_at: string | null;
  expired_at: string | null;
  revenue_saved: number | null;
  /** Procedure of the cancelled slot (from the cancellation event). Null when unknown. */
  procedure_type: string | null;
};

export type TrendDay = { date: string; recovered: number; expired: number };

export type Metrics = {
  slots_total: number;
  slots_recovered: number;
  /** recovered / total, 3 decimal places. Null when there are no rows. */
  recovery_rate: number | null;
  revenue_saved: number;
  /** Minutes, rounded. Null when nothing was recovered. */
  avg_fill_time_minutes: number | null;
  by_stage: Record<Stage, number>;
  by_procedure: Record<string, number>;
  trend: TrendDay[];
};

/** First calendar day (clinic timezone) of the rolling range, including today. */
export function rangeStartDate(range: Range, now: Date, timeZone: string): string {
  return addDays(dateInZone(now, timeZone), -(RANGE_DAYS[range] - 1));
}

export function computeMetrics(rows: readonly MetricRow[], range: Range, now: Date, timeZone: string): Metrics {
  const today = dateInZone(now, timeZone);
  const start = rangeStartDate(range, now, timeZone);
  const inRange = rows.filter((r) => {
    const day = dateInZone(new Date(r.created_at), timeZone);
    return day >= start && day <= today;
  });

  const by_stage = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
  const by_procedure: Record<string, number> = {};
  let recovered = 0;
  let revenue = 0;
  let fillTotal = 0;
  let fillCount = 0;

  const trendMap = new Map<string, TrendDay>();
  for (let i = 0, day = start; day <= today; i++, day = addDays(start, i)) {
    trendMap.set(day, { date: day, recovered: 0, expired: 0 });
  }

  for (const r of inRange) {
    if ((STAGES as readonly string[]).includes(r.stage)) by_stage[r.stage as Stage] += 1;

    if (r.stage === "slot_recovered") {
      recovered += 1;
      revenue += r.revenue_saved ?? 0;
      const key = r.procedure_type ?? "other";
      by_procedure[key] = (by_procedure[key] ?? 0) + 1;
      if (r.confirmed_at) {
        const from = new Date(r.detected_at ?? r.created_at).getTime();
        fillTotal += Math.max(0, new Date(r.confirmed_at).getTime() - from) / 60000;
        fillCount += 1;
      }
    }

    if (r.confirmed_at && r.stage === "slot_recovered") {
      const bucket = trendMap.get(dateInZone(new Date(r.confirmed_at), timeZone));
      if (bucket) bucket.recovered += 1;
    }
    if (r.expired_at) {
      const bucket = trendMap.get(dateInZone(new Date(r.expired_at), timeZone));
      if (bucket) bucket.expired += 1;
    }
  }

  const total = inRange.length;
  return {
    slots_total: total,
    slots_recovered: recovered,
    recovery_rate: total === 0 ? null : Math.round((recovered / total) * 1000) / 1000,
    revenue_saved: revenue,
    avg_fill_time_minutes: fillCount === 0 ? null : Math.round(fillTotal / fillCount),
    by_stage,
    by_procedure,
    trend: [...trendMap.values()],
  };
}

/**
 * Keep daily bars up to `maxDays` (31). Beyond that, group into weeks counted back from the last day,
 * so the first bucket may be shorter. Totals are preserved. Each bucket is labelled by its first day.
 */
export function bucketTrend(trend: readonly TrendDay[], maxDays = 31): TrendDay[] {
  if (trend.length <= maxDays) return trend.map((d) => ({ ...d }));
  const buckets: TrendDay[] = [];
  for (let end = trend.length; end > 0; end -= 7) {
    const slice = trend.slice(Math.max(0, end - 7), end);
    buckets.unshift({
      date: slice[0]!.date,
      recovered: slice.reduce((n, d) => n + d.recovered, 0),
      expired: slice.reduce((n, d) => n + d.expired, 0),
    });
  }
  return buckets;
}
