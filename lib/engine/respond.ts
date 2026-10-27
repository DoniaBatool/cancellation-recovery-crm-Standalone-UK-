import { ApiError } from "@/lib/api/http";
import { isStage } from "@/lib/constants";
import { loadPipeline, nowOf, shortName, uuidOf, type EngineDeps } from "@/lib/engine/context";
import { notifyReception } from "@/lib/engine/approve";
import { advance } from "@/lib/engine/offer";
import { getOfferState, isValidToken, type OfferState } from "@/lib/offers";
import { logHistory, transitionStage } from "@/lib/pipeline";

// The patient's answer. Source: SYSTEM_BUILD_GUIDE.md §6.4 respondToOffer.
// Rule: never lose a YES. If the stage move fails because of a race, the answer is still recorded.

export type Answer = "accepted" | "declined";
export type Via = "link" | "sms_reply" | "whatsapp" | "crm";

export async function respondToOffer(deps: EngineDeps, token: string, answer: Answer, via: Via): Promise<{ state: OfferState }> {
  const now = nowOf(deps);
  if (!isValidToken(token)) return { state: "slot_unavailable" };

  const { data: offer } = await deps.db.from("waitlist_offers").select("*").eq("offer_token", token).maybeSingle();
  if (!offer) return { state: "slot_unavailable" };

  const loaded = await loadPipeline(deps.db, offer.pipeline_id);
  if (!loaded) return { state: "slot_unavailable" };
  const { pipeline } = loaded;

  const state = getOfferState(offer, pipeline, now);
  if (state !== "open") return { state };

  // Record the answer atomically. Zero rows changed means a double tap: report where things stand.
  const { data: recorded } = await deps.db
    .from("waitlist_offers")
    .update({ response: answer, responded_at: now.toISOString(), responded_via: via })
    .eq("id", offer.id)
    .eq("response", "pending")
    .select("id");
  if (!recorded || recorded.length === 0) {
    const { data: current } = await deps.db.from("waitlist_offers").select("*").eq("id", offer.id).maybeSingle();
    return { state: current ? getOfferState(current, pipeline, now) : "slot_unavailable" };
  }

  const { data: patient } = await deps.db.from("waitlist").select("patient_name").eq("id", offer.waitlist_patient_id).maybeSingle();
  const who = patient ? shortName(patient.patient_name) : "The patient";

  if (answer === "declined") {
    await logHistory(deps.db, pipeline, `${who} replied NO.`, "patient");
    await advance(deps, pipeline.id, "engine");
    return { state: "declined" };
  }

  // YES.
  if (pipeline.stage === "offer_sent" && isStage(pipeline.stage)) {
    try {
      await transitionStage(deps.db, {
        pipeline: { id: pipeline.id, stage: pipeline.stage },
        to: "waiting_staff_approval",
        triggeredBy: "patient",
        note: `${who} replied YES.`,
        fields: {
          waitlist_patient_id: offer.waitlist_patient_id,
          approval_token: uuidOf(deps),
          approval_token_expires_at: new Date(now.getTime() + loaded.config.approval_window_minutes * 60_000).toISOString(),
        },
        now,
      });
      await deps.db
        .from("waitlist_offers")
        .update({ response: "expired" })
        .eq("pipeline_id", pipeline.id)
        .eq("response", "pending")
        .neq("id", offer.id);
      await notifyReception(deps, pipeline.id);
    } catch (error) {
      // A race: keep the answer and tell reception to look at the card.
      const reason = error instanceof ApiError ? error.message : "unexpected error";
      console.error("YES recorded but the card could not move:", reason);
      await logHistory(deps.db, pipeline, `${who} replied YES, but the card could not be moved (${reason}). Please check it.`, "patient");
    }
  } else {
    await logHistory(deps.db, pipeline, `${who} replied YES, but the card was already in "${pipeline.stage}". Please check it.`, "patient");
  }
  return { state: "accepted" };
}
