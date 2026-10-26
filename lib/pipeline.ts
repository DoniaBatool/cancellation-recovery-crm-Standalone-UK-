import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api/http";
import { ALLOWED_TRANSITIONS, STAGE_TIMESTAMP, type Actor, type Stage } from "@/lib/constants";
import type { Database, TablesUpdate } from "@/lib/database.types";

// Stage changes. Source: SYSTEM_BUILD_GUIDE.md §6.1 and §3.3 rule 1.
//
// transitionStage() is the ONLY place that changes recovery_pipeline.stage. It
//   1. rejects a disallowed move with ApiError(409, 'invalid_transition');
//   2. updates with .eq('id').eq('stage', current): an optimistic lock, so two webhooks or
//      two clicks cannot double-move a card (0 rows changed -> ApiError(409, 'stage_conflict'));
//   3. sets the stage timestamp;
//   4. writes a recovery_pipeline_history row.

export type Db = SupabaseClient<Database>;

export type PipelineRef = { id: string; stage: Stage };

type PipelineFields = Omit<TablesUpdate<"recovery_pipeline">, "stage" | "id" | "created_at" | "updated_at">;

export type TransitionInput = {
  pipeline: PipelineRef;
  to: Stage;
  triggeredBy: Actor;
  note?: string | null;
  /** Extra columns to set in the same update (for example revenue_saved, approved_at). */
  fields?: PipelineFields;
  /** Injected in tests. */
  now?: Date;
};

export function isTransitionAllowed(from: Stage, to: Stage): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export async function transitionStage(db: Db, input: TransitionInput): Promise<{ id: string; from: Stage; to: Stage }> {
  const { pipeline, to, triggeredBy, note = null, fields = {}, now = new Date() } = input;

  if (!isTransitionAllowed(pipeline.stage, to)) {
    throw new ApiError(409, "invalid_transition", `A card in "${pipeline.stage}" cannot move to "${to}".`);
  }

  const update: TablesUpdate<"recovery_pipeline"> = { ...fields, stage: to };
  const stampColumn = STAGE_TIMESTAMP[to];
  if (stampColumn) (update as Record<string, unknown>)[stampColumn] = now.toISOString();

  const { data, error } = await db
    .from("recovery_pipeline")
    .update(update)
    .eq("id", pipeline.id)
    .eq("stage", pipeline.stage)
    .select("id");

  if (error) throw new ApiError(500, "pipeline_update_failed", "Could not update the card.");
  if (!data || data.length === 0) {
    throw new ApiError(409, "stage_conflict", "This card was changed by someone else. Refresh and try again.");
  }

  // The stage has already moved. A missing history row must not undo or hide that, so log and carry on.
  const { error: historyError } = await db.from("recovery_pipeline_history").insert({
    pipeline_id: pipeline.id,
    from_stage: pipeline.stage,
    to_stage: to,
    note,
    triggered_by: triggeredBy,
  });
  if (historyError) console.error("Could not write pipeline history:", historyError.message);

  return { id: pipeline.id, from: pipeline.stage, to };
}

/** Write a note on a card without changing its stage (from_stage = to_stage). */
export async function logHistory(
  db: Db,
  pipeline: PipelineRef,
  note: string,
  triggeredBy: Actor = "system",
): Promise<boolean> {
  const { error } = await db.from("recovery_pipeline_history").insert({
    pipeline_id: pipeline.id,
    from_stage: pipeline.stage,
    to_stage: pipeline.stage,
    note,
    triggered_by: triggeredBy,
  });
  if (error) {
    console.error("Could not write pipeline history:", error.message);
    return false;
  }
  return true;
}
