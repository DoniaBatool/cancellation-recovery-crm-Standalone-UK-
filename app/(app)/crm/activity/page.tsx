import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { StageBadge } from "@/components/ui/badge";
import { EmptyState, PageHeader } from "@/components/shell/page-header";
import { ACTORS, ACTOR_LABELS, STAGES, isActor, type Actor, type Stage } from "@/lib/constants";
import { formatSlot } from "@/lib/format";
import { procedureLabel } from "@/lib/pricing";
import { requireSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Activity" };

const PAGE_SIZE = 100;
const asStage = (v: string | null): Stage | null => (v && (STAGES as readonly string[]).includes(v) ? (v as Stage) : null);

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ actor?: string }> }) {
  const { actor: actorParam } = await searchParams;
  const actor: Actor | null = isActor(actorParam) ? actorParam : null;

  const { clinic } = await requireSession();
  const supabase = await createSupabaseServerClient();

  // RLS limits history rows to this clinic's cards.
  let query = supabase
    .from("recovery_pipeline_history")
    .select("id, pipeline_id, from_stage, to_stage, note, triggered_by, created_at")
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE);
  if (actor) query = query.eq("triggered_by", actor);
  const { data: rows } = await query;

  const pipelineIds = [...new Set((rows ?? []).map((r) => r.pipeline_id))];
  const { data: pipelines } = pipelineIds.length
    ? await supabase.from("recovery_pipeline").select("id, cancellation_event_id").in("id", pipelineIds)
    : { data: [] };
  const eventIds = [...new Set((pipelines ?? []).map((p) => p.cancellation_event_id))];
  const { data: events } = eventIds.length
    ? await supabase.from("cancellation_events").select("id, slot_datetime, procedure_type").in("id", eventIds)
    : { data: [] };
  const eventByPipeline = new Map(
    (pipelines ?? []).map((p) => [p.id, (events ?? []).find((e) => e.id === p.cancellation_event_id)]),
  );

  const filters: { key: string; label: string; href: string; active: boolean }[] = [
    { key: "all", label: "All", href: "/crm/activity", active: !actor },
    ...ACTORS.map((a) => ({ key: a, label: ACTOR_LABELS[a], href: `/crm/activity?actor=${a}`, active: actor === a })),
  ];

  return (
    <>
      <PageHeader title="Activity" description="Everything that happened to each cancelled slot, newest first." />

      <nav aria-label="Filter by who did it" className="mb-4 flex flex-wrap gap-2">
        {filters.map((f) => (
          <Link
            key={f.key}
            href={f.href}
            aria-current={f.active ? "page" : undefined}
            className={cn(
              "inline-flex h-9 items-center rounded-full border px-3 text-sm transition-colors duration-200 hover:bg-accent",
              f.active ? "border-primary bg-accent font-medium text-link" : "border-input bg-card text-foreground",
            )}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      {(rows ?? []).length === 0 ? (
        <EmptyState
          title="Nothing has happened yet."
          description={actor ? "No activity from this source. Try All." : "When a cancellation comes in, its steps will show up here."}
        />
      ) : (
        <ol className="flex flex-col gap-2">
          {(rows ?? []).map((r) => {
            const from = asStage(r.from_stage);
            const to = asStage(r.to_stage);
            const event = eventByPipeline.get(r.pipeline_id);
            const who = isActor(r.triggered_by) ? ACTOR_LABELS[r.triggered_by] : r.triggered_by;
            return (
              <li key={r.id} className="rounded-lg border bg-card px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <time dateTime={r.created_at} className="text-muted-foreground">
                    {formatSlot(r.created_at, clinic.timezone)}
                  </time>
                  {event ? (
                    <span className="font-medium">
                      {procedureLabel(event.procedure_type)} · {formatSlot(event.slot_datetime, clinic.timezone)}
                    </span>
                  ) : null}
                  <span className="flex items-center gap-1.5">
                    {from && from !== to ? (
                      <>
                        <StageBadge stage={from} />
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-label="moved to" />
                      </>
                    ) : null}
                    {to ? <StageBadge stage={to} /> : null}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">{who}</span>
                </div>
                {r.note ? <p className="mt-1.5 text-sm text-foreground">{r.note}</p> : null}
              </li>
            );
          })}
        </ol>
      )}
      {(rows ?? []).length === PAGE_SIZE ? (
        <p className="mt-3 text-center text-xs text-muted-foreground">Showing the latest {PAGE_SIZE} entries.</p>
      ) : null}
    </>
  );
}
