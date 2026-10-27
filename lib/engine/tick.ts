import { loadPipeline, nowOf, shortName, type EngineDeps } from "@/lib/engine/context";
import { notifyReception } from "@/lib/engine/approve";
import { advance, giveUp, offerNext } from "@/lib/engine/offer";
import { logHistory } from "@/lib/pipeline";

// The once-a-minute tick. Source: SYSTEM_BUILD_GUIDE.md §7 E8 (tick cron) and E6 (approval reminders).
//  1. offers past their expiry -> expired, then the next patient
//  2. quiet-hours holds whose time has come -> send the offers
//  3. approval reminder at 50% of the window; give up when the slot is about to start
//  4. cards stuck in "Cancellation detected" for over 2 minutes while the engine is on -> start offers
// Runs overlap safely: every step relies on the optimistic stage lock and "WHERE response = 'pending'".

const isOpenStage = (stage: string) => stage === "cancellation_detected" || stage === "offer_sent" || stage === "waiting_staff_approval";

export type TickSummary = {
  expiredOffers: number;
  advanced: number;
  resumed: number;
  reminded: number;
  timedOut: number;
  healed: number;
};

const SELF_HEAL_AFTER_MS = 2 * 60_000;

export async function runTick(deps: EngineDeps): Promise<TickSummary> {
  const now = nowOf(deps);
  const summary: TickSummary = { expiredOffers: 0, advanced: 0, resumed: 0, reminded: 0, timedOut: 0, healed: 0 };

  // Each step is isolated: one broken card must not stop the others.
  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (error) {
      console.error(`Tick step "${name}" failed:`, error instanceof Error ? error.message : error);
    }
  };

  await step("expire offers", async () => {
    const { data: pending } = await deps.db
      .from("waitlist_offers")
      .select("id, pipeline_id, waitlist_patient_id, offer_expires_at")
      .eq("response", "pending");
    const due = (pending ?? []).filter((o) => o.offer_expires_at && new Date(o.offer_expires_at).getTime() < now.getTime());
    const pipelines = new Set<string>();
    for (const offer of due) {
      const { data: claimed } = await deps.db
        .from("waitlist_offers")
        .update({ response: "expired" })
        .eq("id", offer.id)
        .eq("response", "pending")
        .select("id");
      if (!claimed || claimed.length === 0) continue; // someone answered at the last second
      summary.expiredOffers += 1;
      pipelines.add(offer.pipeline_id);
      const { data: patient } = await deps.db.from("waitlist").select("patient_name").eq("id", offer.waitlist_patient_id).maybeSingle();
      await logHistory(
        deps.db,
        { id: offer.pipeline_id, stage: "offer_sent" },
        `Offer to ${patient ? shortName(patient.patient_name) : "the patient"} expired with no answer.`,
        "engine",
      );
    }
    for (const pipelineId of pipelines) {
      const run = await advance(deps, pipelineId);
      if (run.status !== "skipped") summary.advanced += 1;
    }
  });

  await step("resume quiet hours", async () => {
    const { data: rows } = await deps.db.from("engine_state").select("clinic_id, key, value");
    for (const row of (rows ?? []).filter((r) => r.key.startsWith("deferred:"))) {
      const resumeAt = (row.value as { resume_at?: string } | null)?.resume_at;
      if (!resumeAt || new Date(resumeAt).getTime() > now.getTime()) continue;
      const { data: claimed } = await deps.db.from("engine_state").delete().eq("clinic_id", row.clinic_id).eq("key", row.key).select("key");
      if (!claimed || claimed.length === 0) continue; // another run took it
      const pipelineId = row.key.slice("deferred:".length);
      const loaded = await loadPipeline(deps.db, pipelineId);
      if (!loaded || !isOpenStage(loaded.pipeline.stage)) continue;
      const run = await offerNext(deps, pipelineId);
      if (run.status !== "skipped") summary.resumed += 1;
    }
  });

  await step("approval reminders", async () => {
    const { data: waiting } = await deps.db.from("recovery_pipeline").select("id").eq("stage", "waiting_staff_approval");
    for (const { id } of waiting ?? []) {
      const loaded = await loadPipeline(deps.db, id);
      if (!loaded || loaded.pipeline.stage !== "waiting_staff_approval") continue;
      const { pipeline, event, config, clinic } = loaded;

      // Slot about to start and still unapproved: close the card and alert reception.
      const slotMs = new Date(event.slot_datetime).getTime();
      if (slotMs - now.getTime() < config.min_lead_minutes * 60_000) {
        const run = await giveUp(deps, id, "slot too close, nobody approved in time");
        if (run.status === "gave_up") summary.timedOut += 1;
        continue;
      }

      const windowMs = config.approval_window_minutes * 60_000;
      const requestedMs = pipeline.approval_requested_at
        ? new Date(pipeline.approval_requested_at).getTime()
        : pipeline.approval_token_expires_at
          ? new Date(pipeline.approval_token_expires_at).getTime() - windowMs
          : null;
      if (requestedMs === null || now.getTime() < requestedMs + windowMs / 2) continue;

      // One reminder only: claim it with a marker row.
      const key = `reminded:${id}`;
      const { data: existing } = await deps.db.from("engine_state").select("key").eq("clinic_id", clinic.id).eq("key", key).maybeSingle();
      if (existing) continue;
      await deps.db.from("engine_state").upsert({ clinic_id: clinic.id, key, value: { at: now.toISOString() } }, { onConflict: "clinic_id,key" });
      await notifyReception(deps, id, { reminder: true });
      summary.reminded += 1;
    }
  });

  await step("self-heal", async () => {
    const { data: stuck } = await deps.db.from("recovery_pipeline").select("id, clinic_id, detected_at, created_at").eq("stage", "cancellation_detected");
    for (const card of stuck ?? []) {
      const since = new Date(card.detected_at ?? card.created_at).getTime();
      if (now.getTime() - since < SELF_HEAL_AFTER_MS) continue;
      const loaded = await loadPipeline(deps.db, card.id);
      // With the engine off a card waits for reception ("Start offers"); the tick must not close it.
      if (!loaded || !loaded.config.engine_enabled) continue;
      // A card held for quiet hours is already handled by step 2.
      const { data: held } = await deps.db.from("engine_state").select("key").eq("clinic_id", card.clinic_id).eq("key", `deferred:${card.id}`).maybeSingle();
      if (held) continue;
      const run = await offerNext(deps, card.id);
      if (run.status !== "skipped") summary.healed += 1;
    }
  });

  return summary;
}
