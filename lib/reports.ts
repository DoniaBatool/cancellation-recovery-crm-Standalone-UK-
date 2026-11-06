import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import { dateInZone } from "@/lib/time";

// Monthly reports (PORT_REPORTS_AND_CLINIC_SETUP.md, Part A). Admin features only: counts and money, no clinical data.

type Db = SupabaseClient<Database>;
type One<T> = T | T[] | null | undefined;
const first = <T,>(value: One<T>): T | null => (Array.isArray(value) ? (value[0] ?? null) : (value ?? null));

/** One calendar month, "YYYY-MM" (clinic timezone). */
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface ReportPipelineRow {
  stage: string;
  revenue_saved: number | null;
  created_at: string;
  detected_at: string | null;
  offer_sent_at: string | null;
  confirmed_at: string | null;
  procedure_type: string | null;
}

export interface ProcedureLine {
  procedure: string;
  gaps: number;
  filled: number;
  revenue: number;
}

/**
 * Frozen numbers for one clinic-month. "Cohort" basis: every gap (cancellation) detected in the
 * month, and what became of it, so the fill rate can never exceed 100%.
 */
export interface MonthlyReportData {
  version: 1;
  month: string;
  clinic_name: string;
  timezone: string;
  gaps: number;
  offers_sent: number;
  filled: number;
  expired: number;
  still_open: number;
  fill_rate: number;
  revenue_recovered: number;
  avg_fill_minutes: number | null;
  by_procedure: ProcedureLine[];
  generated_at: string;
}

/** Display name for a by-treatment line ("unknown" means the cancellation had no treatment set). */
export const reportProcedureLabel = (procedure: string): string => (procedure === "unknown" ? "Not specified" : procedure.charAt(0).toUpperCase() + procedure.slice(1));

/** "YYYY-MM-DD" of an instant in the clinic's timezone. */
const dayKey = (value: string | Date, timeZone: string) => dateInZone(value instanceof Date ? value : new Date(value), timeZone);

export function currentMonth(timeZone: string, now: Date = new Date()): string {
  return dayKey(now, timeZone).slice(0, 7);
}

export function parseMonth(value: string | string[] | undefined, fallback: string): string {
  return typeof value === "string" && MONTH_RE.test(value) ? value : fallback;
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const index = y * 12 + (m - 1) + delta;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** Newest first, e.g. ["2026-10", "2026-09", ...]. */
export function recentMonths(timeZone: string, count = 12, now: Date = new Date()): string[] {
  const current = currentMonth(timeZone, now);
  return Array.from({ length: count }, (_, i) => addMonths(current, -i));
}

export function formatMonth(month: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", month: "long", year: "numeric" }).format(new Date(`${month}-01T12:00:00Z`));
}

/** A month is final once it is over in the clinic's timezone. */
export function isMonthClosed(month: string, timeZone: string, now: Date = new Date()): boolean {
  return month < currentMonth(timeZone, now);
}

/** Pure aggregation; rows may include a day either side of the month, they are filtered here. */
export function computeMonthlyReport(
  rows: ReportPipelineRow[],
  month: string,
  clinicName: string,
  timeZone: string,
  now: Date = new Date(),
): MonthlyReportData {
  const byProcedure = new Map<string, ProcedureLine>();
  let gaps = 0;
  let offers = 0;
  let filled = 0;
  let expired = 0;
  let revenue = 0;
  const fillMinutes: number[] = [];

  for (const row of rows) {
    const detected = row.detected_at ?? row.created_at;
    if (dayKey(detected, timeZone).slice(0, 7) !== month) continue;
    gaps += 1;
    if (row.offer_sent_at) offers += 1;

    const procedure = row.procedure_type ?? "unknown";
    const line = byProcedure.get(procedure) ?? { procedure, gaps: 0, filled: 0, revenue: 0 };
    line.gaps += 1;

    if (row.stage === "slot_recovered" && row.confirmed_at) {
      filled += 1;
      line.filled += 1;
      const saved = row.revenue_saved ?? 0;
      revenue += saved;
      line.revenue += saved;
      fillMinutes.push(Math.max(0, (Date.parse(row.confirmed_at) - Date.parse(detected)) / 60_000));
    } else if (row.stage === "expired_manual") {
      expired += 1;
    }
    byProcedure.set(procedure, line);
  }

  return {
    version: 1,
    month,
    clinic_name: clinicName,
    timezone: timeZone,
    gaps,
    offers_sent: offers,
    filled,
    expired,
    still_open: gaps - filled - expired,
    fill_rate: gaps ? Math.round((filled / gaps) * 1000) / 1000 : 0,
    revenue_recovered: Math.round(revenue * 100) / 100,
    avg_fill_minutes: fillMinutes.length ? Math.round(fillMinutes.reduce((sum, m) => sum + m, 0) / fillMinutes.length) : null,
    by_procedure: [...byProcedure.values()].sort((a, b) => b.filled - a.filled || b.gaps - a.gaps),
    generated_at: now.toISOString(),
  };
}

type ClinicRef = { id: string; name: string; timezone: string };

/** Loads the month's pipelines (RLS-scoped client + explicit clinic filter) and aggregates them. */
export async function buildMonthlyReport(db: Db, clinic: ClinicRef, month: string, now: Date = new Date()): Promise<MonthlyReportData> {
  const firstDay = new Date(`${month}-01T00:00:00Z`);
  const from = new Date(firstDay.getTime() - 2 * 86_400_000).toISOString();
  const to = new Date(Date.UTC(firstDay.getUTCFullYear(), firstDay.getUTCMonth() + 1, 3)).toISOString();
  const { data, error } = await db
    .from("recovery_pipeline")
    .select("stage, revenue_saved, created_at, detected_at, offer_sent_at, confirmed_at, cancellation_events(procedure_type)")
    .eq("clinic_id", clinic.id)
    .gte("created_at", from)
    .lt("created_at", to)
    .limit(5000);
  if (error) throw error;

  const rows: ReportPipelineRow[] = (data ?? []).map(({ cancellation_events, ...row }) => ({
    ...row,
    procedure_type: first(cancellation_events)?.procedure_type ?? null,
  }));
  return computeMonthlyReport(rows, month, clinic.name, clinic.timezone, now);
}

export interface LoadedReport {
  data: MonthlyReportData;
  /** True when this exact snapshot is stored in monthly_reports. */
  saved: boolean;
}

/** Saves (insert or replace) the snapshot for a clinic-month. */
export async function saveMonthlyReport(db: Db, clinicId: string, data: MonthlyReportData): Promise<void> {
  const { error } = await db
    .from("monthly_reports")
    .upsert({ clinic_id: clinicId, month: `${data.month}-01`, data: data as unknown as Json, generated_at: data.generated_at }, { onConflict: "clinic_id,month" });
  if (error) throw error;
}

/**
 * Closed months: the saved snapshot if there is one, otherwise build it and save it (it is final).
 * The running month is always live and never saved until it closes (or the user presses Save).
 */
export async function loadMonthlyReport(db: Db, clinic: ClinicRef, month: string, now: Date = new Date()): Promise<LoadedReport> {
  const { data: stored, error } = await db.from("monthly_reports").select("data").eq("clinic_id", clinic.id).eq("month", `${month}-01`).maybeSingle();
  if (error) throw error;
  const closed = isMonthClosed(month, clinic.timezone, now);
  if (stored && closed) return { data: stored.data as unknown as MonthlyReportData, saved: true };

  const data = await buildMonthlyReport(db, clinic, month, now);
  if (closed) {
    await saveMonthlyReport(db, clinic.id, data);
    return { data, saved: true };
  }
  return { data, saved: false };
}

/** Months that have a saved snapshot (for the "saved" markers). */
export async function listSavedMonths(db: Db, clinicId: string): Promise<string[]> {
  const { data, error } = await db.from("monthly_reports").select("month").eq("clinic_id", clinicId).order("month", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => r.month.slice(0, 7));
}
