import type { Metadata } from "next";
import { CalendarCheck, Clock, PoundSterling, Percent } from "lucide-react";
import { PageHeader, EmptyState } from "@/components/shell/page-header";
import { RangeTabs } from "@/components/ui/range-tabs";
import { StatTile } from "@/components/ui/stat-tile";
import { parseRange } from "@/lib/constants";
import { formatGBP } from "@/lib/format";

export const metadata: Metadata = { title: "Dashboard" };

// Phase 1: the layout and empty state only. Real numbers (lib/metrics.ts) arrive in Phase 3.
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string | string[] }>;
}) {
  const range = parseRange((await searchParams).range);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="How many cancelled slots were filled again."
        actions={<RangeTabs current={range} basePath="/dashboard" />}
      />

      <section aria-label="Summary" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Revenue saved" value={formatGBP(0)} icon={<PoundSterling className="h-4 w-4" aria-hidden="true" />} />
        <StatTile
          label="Slots recovered"
          value="0"
          hint="of 0 cancellations"
          icon={<CalendarCheck className="h-4 w-4" aria-hidden="true" />}
        />
        <StatTile label="Recovery rate" value="—" icon={<Percent className="h-4 w-4" aria-hidden="true" />} />
        <StatTile label="Average fill time" value="—" icon={<Clock className="h-4 w-4" aria-hidden="true" />} />
      </section>

      <div className="mt-6">
        <EmptyState title="When a cancellation comes in, it will show up here." />
      </div>
    </>
  );
}
