import type { Metadata } from "next";
import { CalendarCheck, Clock, Percent, PoundSterling } from "lucide-react";
import { EmptyState, PageHeader } from "@/components/shell/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { RangeTabs } from "@/components/ui/range-tabs";
import { StatTile } from "@/components/ui/stat-tile";
import { parseRange } from "@/lib/constants";
import { toMetricRows, toRecentRecoveries } from "@/lib/dashboard-data";
import { formatGBP, formatPercent, formatSlot } from "@/lib/format";
import { bucketTrend, computeMetrics, rangeStartDate } from "@/lib/metrics";
import { addDaysToDate, formatDuration } from "@/lib/time";
import { procedureLabel } from "@/lib/pricing";
import { requireSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ProcedureChart, TrendChart } from "./charts";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

// Real numbers from lib/metrics.ts (guide §6.9). RLS limits every query to the user's clinic.
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string | string[] }>;
}) {
  const range = parseRange((await searchParams).range);
  const { clinic } = await requireSession();
  const supabase = await createSupabaseServerClient();

  const now = new Date();
  // One extra day on each side so the clinic-timezone day boundary is never cut off; computeMetrics filters exactly.
  const since = `${addDaysToDate(rangeStartDate(range, now, clinic.timezone), -1)}T00:00:00Z`;

  const [{ data: pipelineRows }, { data: recoveredRows }] = await Promise.all([
    supabase
      .from("recovery_pipeline")
      .select("stage, created_at, detected_at, confirmed_at, expired_at, revenue_saved, cancellation_events(procedure_type)")
      .gte("created_at", since)
      .limit(5000),
    supabase
      .from("recovery_pipeline")
      .select("id, revenue_saved, confirmed_at, waitlist(patient_name), cancellation_events(slot_datetime, procedure_type)")
      .eq("stage", "slot_recovered")
      .order("confirmed_at", { ascending: false })
      .limit(6),
  ]);

  const metrics = computeMetrics(toMetricRows(pipelineRows ?? []), range, now, clinic.timezone);
  const recent = toRecentRecoveries(recoveredRows ?? []);

  const trend = bucketTrend(metrics.trend, 31).map((d) => ({
    label: new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d.date}T00:00:00Z`)),
    recovered: d.recovered,
    expired: d.expired,
  }));
  const byProcedure = Object.entries(metrics.by_procedure)
    .map(([key, recovered]) => ({ label: procedureLabel(key), recovered }))
    .sort((a, b) => b.recovered - a.recovered);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="How many cancelled slots were filled again."
        actions={<RangeTabs current={range} basePath="/dashboard" />}
      />

      <section aria-label="Summary" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Revenue saved" value={formatGBP(metrics.revenue_saved)} icon={<PoundSterling className="h-4 w-4" aria-hidden="true" />} />
        <StatTile
          label="Slots recovered"
          value={String(metrics.slots_recovered)}
          hint={`of ${metrics.slots_total} cancellation${metrics.slots_total === 1 ? "" : "s"}`}
          icon={<CalendarCheck className="h-4 w-4" aria-hidden="true" />}
        />
        <StatTile
          label="Recovery rate"
          value={metrics.recovery_rate === null ? "—" : formatPercent(metrics.recovery_rate)}
          icon={<Percent className="h-4 w-4" aria-hidden="true" />}
        />
        <StatTile
          label="Average fill time"
          value={metrics.avg_fill_time_minutes === null ? "—" : formatDuration(metrics.avg_fill_time_minutes)}
          icon={<Clock className="h-4 w-4" aria-hidden="true" />}
        />
      </section>

      {metrics.slots_total === 0 ? (
        <div className="mt-6">
          <EmptyState title="When a cancellation comes in, it will show up here." />
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Recovery trend</CardTitle>
              <CardDescription>Slots recovered and slots that expired, by day.</CardDescription>
            </CardHeader>
            <CardContent>
              <TrendChart data={trend} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recovered by treatment</CardTitle>
            </CardHeader>
            <CardContent>
              {byProcedure.length === 0 ? (
                <p className="text-sm text-muted-foreground">No recovered slots in this period yet.</p>
              ) : (
                <ProcedureChart data={byProcedure} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent recoveries</CardTitle>
            </CardHeader>
            <CardContent>
              {recent.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing recovered yet.</p>
              ) : (
                <ul className="divide-y">
                  {recent.map((r) => (
                    <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{r.patientName}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {r.slotIso ? formatSlot(r.slotIso, clinic.timezone) : "—"} · {procedureLabel(r.procedure)}
                        </p>
                      </div>
                      <span className="shrink-0 font-semibold">{formatGBP(r.revenue)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
