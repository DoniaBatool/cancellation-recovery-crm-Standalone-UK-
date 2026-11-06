import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck2, Download, PoundSterling, Send, Timer, TrendingUp, Unplug } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { StatTile } from "@/components/ui/stat-tile";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import { formatGBP, formatPercent } from "@/lib/format";
import { currentMonth, formatMonth, listSavedMonths, loadMonthlyReport, parseMonth, recentMonths, reportProcedureLabel } from "@/lib/reports";
import { requireSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatDuration } from "@/lib/time";
import { saveReportAction } from "./actions";

export const metadata: Metadata = { title: "Monthly reports" };
export const dynamic = "force-dynamic";

// Monthly reports (PORT_REPORTS_AND_CLINIC_SETUP.md, Part A). RLS limits every query to the user's clinic.
export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ month?: string | string[] }> }) {
  const { clinic } = await requireSession();
  const now = currentMonth(clinic.timezone);
  const month = parseMonth((await searchParams).month, now);
  const db = await createSupabaseServerClient();
  const [{ data: report, saved }, savedMonths] = await Promise.all([loadMonthlyReport(db, clinic, month), listSavedMonths(db, clinic.id)]);
  const months = [...new Set([...recentMonths(clinic.timezone, 12), month])].sort().reverse();

  return (
    <>
      <PageHeader
        title="Monthly reports"
        description={`${clinic.name} · ${formatMonth(month)}${month === now ? " (so far)" : ""}`}
        actions={
          <>
            <form action={saveReportAction}>
              <input type="hidden" name="month" value={month} />
              <Button type="submit" variant="outline">
                {saved ? "Refresh saved report" : "Save this report"}
              </Button>
            </form>
            <Button asChild>
              <a href={`/reports/pdf?month=${month}`}>
                <Download className="h-4 w-4" aria-hidden="true" /> Download PDF
              </a>
            </Button>
          </>
        }
      />

      <nav aria-label="Month" className="mb-6 flex flex-wrap gap-1.5">
        {months.map((m) => (
          <Link
            key={m}
            href={m === now ? "/reports" : `/reports?month=${m}`}
            aria-current={m === month ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 items-center rounded-md border px-3 text-xs font-medium transition-colors duration-150",
              m === month ? "bg-card text-primary shadow-sm" : "bg-muted text-muted-foreground hover:text-primary",
            )}
          >
            {formatMonth(m)}
            {savedMonths.includes(m) ? (
              <span className="ml-1.5 text-success" title="Saved">
                <span aria-hidden="true">●</span>
                <span className="sr-only"> (saved)</span>
              </span>
            ) : null}
          </Link>
        ))}
      </nav>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatTile label="Gaps found" value={String(report.gaps)} hint="Cancellations detected this month" icon={<Unplug className="h-4 w-4" aria-hidden="true" />} />
        <StatTile label="Offers sent" value={String(report.offers_sent)} hint="Waitlist patients messaged" icon={<Send className="h-4 w-4" aria-hidden="true" />} />
        <StatTile
          label="Slots filled"
          value={String(report.filled)}
          hint={`${report.expired} expired / manual · ${report.still_open} still open`}
          icon={<CalendarCheck2 className="h-4 w-4" aria-hidden="true" />}
        />
        <StatTile label="Fill rate" value={formatPercent(report.fill_rate)} hint="Slots filled ÷ gaps found" icon={<TrendingUp className="h-4 w-4" aria-hidden="true" />} />
        <StatTile label="Revenue recovered" value={formatGBP(report.revenue_recovered)} hint="Value of the filled slots" icon={<PoundSterling className="h-4 w-4" aria-hidden="true" />} />
        <StatTile
          label="Average fill time"
          value={report.avg_fill_minutes === null ? "-" : formatDuration(report.avg_fill_minutes)}
          hint="From cancellation to confirmed booking"
          icon={<Timer className="h-4 w-4" aria-hidden="true" />}
        />
      </div>

      <section className="mt-4 rounded-lg border bg-card shadow-sm" aria-labelledby="by-treatment">
        <h2 id="by-treatment" className="px-5 pb-3 pt-5 text-base font-semibold text-foreground">
          By treatment
        </h2>
        {report.by_procedure.length === 0 ? (
          <p className="px-5 pb-8 pt-2 text-center text-sm text-muted-foreground">No cancellations were recorded this month.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Treatment</TableHead>
                <TableHead className="text-right">Gaps</TableHead>
                <TableHead className="text-right">Filled</TableHead>
                <TableHead className="pr-5 text-right">Recovered</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.by_procedure.map((p) => (
                <TableRow key={p.procedure}>
                  <TableCell className="pl-5 font-medium">{reportProcedureLabel(p.procedure)}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.gaps}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.filled}</TableCell>
                  <TableCell className="pr-5 text-right font-semibold tabular-nums text-success">{formatGBP(p.revenue)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </section>

      <p className="mt-4 text-xs text-muted-foreground">
        Every gap detected in {formatMonth(month)} and what became of it. Finished months are saved automatically (●) and stay the same.
      </p>
    </>
  );
}
