import type { MetricRow } from "@/lib/metrics";

// Shapes the dashboard queries into plain rows for lib/metrics.ts and the "recent recoveries" list.
// PostgREST returns an embedded row as an object (or sometimes a one-item array), so both are handled.

type One<T> = T | T[] | null | undefined;
const first = <T,>(value: One<T>): T | null => (Array.isArray(value) ? (value[0] ?? null) : (value ?? null));

export type PipelineQueryRow = {
  stage: string;
  created_at: string;
  detected_at: string | null;
  confirmed_at: string | null;
  expired_at: string | null;
  revenue_saved: number | null;
  cancellation_events: One<{ procedure_type: string | null }>;
};

export function toMetricRows(rows: readonly PipelineQueryRow[]): MetricRow[] {
  return rows.map((r) => ({
    stage: r.stage,
    created_at: r.created_at,
    detected_at: r.detected_at,
    confirmed_at: r.confirmed_at,
    expired_at: r.expired_at,
    revenue_saved: r.revenue_saved,
    procedure_type: first(r.cancellation_events)?.procedure_type ?? null,
  }));
}

export type RecoveredQueryRow = {
  id: string;
  revenue_saved: number | null;
  confirmed_at: string | null;
  waitlist: One<{ patient_name: string }>;
  cancellation_events: One<{ slot_datetime: string; procedure_type: string | null }>;
};

export type RecentRecovery = {
  id: string;
  patientName: string;
  slotIso: string | null;
  procedure: string | null;
  revenue: number;
};

export function toRecentRecoveries(rows: readonly RecoveredQueryRow[]): RecentRecovery[] {
  return rows.map((r) => {
    const event = first(r.cancellation_events);
    return {
      id: r.id,
      patientName: first(r.waitlist)?.patient_name ?? "Patient removed",
      slotIso: event?.slot_datetime ?? null,
      procedure: event?.procedure_type ?? null,
      revenue: r.revenue_saved ?? 0,
    };
  });
}
