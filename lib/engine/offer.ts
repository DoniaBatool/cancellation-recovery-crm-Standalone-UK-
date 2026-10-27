import { ApiError } from "@/lib/api/http";
import type { Actor } from "@/lib/constants";
import { clinicInfo, loadPipeline, nowOf, shortName, slotInfo, uuidOf, type EngineDeps, type Loaded } from "@/lib/engine/context";
import type { OfferChannel } from "@/lib/engine/notifier";
import { formatTime } from "@/lib/format";
import { logHistory, transitionStage } from "@/lib/pipeline";
import { quietHoursResume } from "@/lib/quiet-hours";
import { matchWaitlist, type Candidate } from "@/lib/waitlist-matching";

// Offers out and moving on. Source: SYSTEM_BUILD_GUIDE.md §7 E4 (startOffers, offerNext) and
// E8 (advance, giveUp). These functions run with the admin client, never from the browser.

export type OfferRun =
  | { status: "offered"; patientIds: string[] }
  | { status: "gave_up"; reason: string }
  | { status: "deferred"; resumeAt: string }
  | { status: "skipped"; reason: string };

const OPEN_STAGES = ["cancellation_detected", "offer_sent", "waiting_staff_approval"] as const;
const isOpenStage = (stage: string) => (OPEN_STAGES as readonly string[]).includes(stage);

/** Offer rows for this card so far (any response). */
async function offersSoFar(deps: EngineDeps, pipelineId: string) {
  const { data } = await deps.db
    .from("waitlist_offers")
    .select("id, waitlist_patient_id, response, offer_expires_at")
    .eq("pipeline_id", pipelineId);
  return data ?? [];
}

/** First offer of a card. Only valid while the card is still in "Cancellation detected". */
export async function startOffers(deps: EngineDeps, pipelineId: string, triggeredBy: Actor = "engine"): Promise<OfferRun> {
  const loaded = await loadPipeline(deps.db, pipelineId);
  if (!loaded) return { status: "skipped", reason: "Card not found." };
  if (loaded.pipeline.stage !== "cancellation_detected") {
    return { status: "skipped", reason: "Offers have already started for this card." };
  }
  return offerNext(deps, pipelineId, triggeredBy, loaded);
}

/**
 * Offer the slot to the next patient (or a batch). Gives up when the engine is off, the slot is too
 * close, the offer limit is reached, or nobody matches. During quiet hours the send is held until
 * they end (engine_state "deferred:<pipelineId>"), unless the slot starts before then.
 */
export async function offerNext(
  deps: EngineDeps,
  pipelineId: string,
  triggeredBy: Actor = "engine",
  preloaded?: Loaded,
): Promise<OfferRun> {
  const now = nowOf(deps);
  const loaded = preloaded ?? (await loadPipeline(deps.db, pipelineId));
  if (!loaded) return { status: "skipped", reason: "Card not found." };
  const { pipeline, event, clinic, config } = loaded;
  if (!isOpenStage(pipeline.stage)) return { status: "skipped", reason: "This card is already closed." };

  const slot = new Date(event.slot_datetime);
  const offers = await offersSoFar(deps, pipeline.id);

  if (!config.engine_enabled) return giveUp(deps, pipeline.id, "the offer engine is switched off", triggeredBy, loaded);
  if (slot.getTime() - now.getTime() < config.min_lead_minutes * 60_000) {
    return giveUp(deps, pipeline.id, "slot too close", triggeredBy, loaded);
  }
  if (offers.length >= config.max_offers_per_slot) {
    return giveUp(deps, pipeline.id, "offer limit reached, nobody accepted", triggeredBy, loaded);
  }

  // Quiet hours: hold the offer, unless the slot would start before they end.
  const resume = quietHoursResume(now, config.quiet_hours_start, config.quiet_hours_end, clinic.timezone);
  if (resume) {
    if (slot.getTime() <= resume.getTime() + config.min_lead_minutes * 60_000) {
      return giveUp(deps, pipeline.id, "slot too close (quiet hours)", triggeredBy, loaded);
    }
    await deps.db.from("engine_state").upsert(
      { clinic_id: clinic.id, key: `deferred:${pipeline.id}`, value: { resume_at: resume.toISOString() } },
      { onConflict: "clinic_id,key" },
    );
    await logHistory(deps.db, pipeline, `Offers held until ${formatTime(resume, clinic.timezone)} (quiet hours).`, "engine");
    return { status: "deferred", resumeAt: resume.toISOString() };
  }

  // Who can be offered this slot: matching rules, and a channel the notifier can really use.
  const { data: waitlist } = await deps.db.from("waitlist").select("*").eq("clinic_id", clinic.id).eq("is_active", true);
  const wanted = config.offer_channels.filter((c): c is OfferChannel => c === "email" || c === "sms");
  const usable = (c: Candidate): OfferChannel[] =>
    wanted.filter((ch) => deps.notifier.channels.includes(ch)).filter((ch) => (ch === "email" ? Boolean(c.email) : Boolean(c.phone) && !c.sms_opt_out));

  const matches = matchWaitlist(
    waitlist ?? [],
    { datetime: slot, procedure: event.procedure_type, doctor: event.doctor_name, timeZone: clinic.timezone },
    now,
    { excludePatientIds: offers.map((o) => o.waitlist_patient_id) },
  ).filter((m) => usable(m.patient).length > 0);

  const take = config.offer_strategy === "batch" ? config.batch_size : 1;
  const chosen = matches.slice(0, take);
  if (chosen.length === 0) {
    return giveUp(deps, pipeline.id, offers.length === 0 ? "no waitlist match" : "nobody accepted", triggeredBy, loaded);
  }

  const expiresAt = new Date(now.getTime() + config.offer_expiry_minutes * 60_000).toISOString();
  const rows = chosen.map((m) => ({
    pipeline_id: pipeline.id,
    waitlist_patient_id: m.patient.id,
    offer_token: uuidOf(deps),
    offer_expires_at: expiresAt,
  }));
  const { data: inserted, error: insertError } = await deps.db
    .from("waitlist_offers")
    .insert(rows)
    .select("id, waitlist_patient_id, offer_token");
  if (insertError || !inserted || inserted.length === 0) {
    console.error("Could not save offers:", insertError?.message);
    return { status: "skipped", reason: "Could not save the offers." };
  }
  await deps.db
    .from("waitlist")
    .update({ last_contacted_at: now.toISOString() })
    .in("id", chosen.map((m) => m.patient.id));

  const first = chosen[0]!;
  const via = usable(first.patient).join(" + ");
  const names = chosen.map((m) => shortName(m.patient.patient_name)).join(", ");
  try {
    await transitionStage(deps.db, {
      pipeline: { id: pipeline.id, stage: pipeline.stage },
      to: "offer_sent",
      triggeredBy,
      note: `Offer sent to ${names} (${via}).`,
      fields: { waitlist_patient_id: first.patient.id, approval_token: null, approval_token_expires_at: null },
      now,
    });
  } catch (error) {
    // Someone moved the card first. Withdraw the offers we just created so nobody is left waiting.
    await deps.db
      .from("waitlist_offers")
      .update({ response: "expired" })
      .in("id", inserted.map((o) => o.id))
      .eq("response", "pending");
    if (error instanceof ApiError) return { status: "skipped", reason: error.message };
    throw error;
  }

  // Send. A failed send never undoes the stage change; reception sees a note and can call the patient.
  for (const match of chosen) {
    const offer = inserted.find((o) => o.waitlist_patient_id === match.patient.id);
    if (!offer?.offer_token) continue;
    let sent: OfferChannel[] = [];
    try {
      sent = await deps.notifier.offerOut({
        clinic: clinicInfo(clinic),
        slot: slotInfo(event),
        patient: { id: match.patient.id, name: match.patient.patient_name, email: match.patient.email, phone: match.patient.phone },
        pipelineId: pipeline.id,
        offerId: offer.id,
        offerToken: offer.offer_token,
        offerExpiresAt: expiresAt,
        offerExpiryMinutes: config.offer_expiry_minutes,
        channels: usable(match.patient),
        preferredDoctorMatch: match.preferredDoctorMatch,
        shadowMode: config.shadow_mode,
      });
    } catch (error) {
      console.error("Offer send failed:", error instanceof Error ? error.message : error);
    }
    if (sent.length === 0) {
      await logHistory(
        deps.db,
        { id: pipeline.id, stage: "offer_sent" },
        `Offer to ${shortName(match.patient.patient_name)} could not be delivered. Call the patient if the slot is still open.`,
        "engine",
      );
    }
  }

  return { status: "offered", patientIds: chosen.map((m) => m.patient.id) };
}

/**
 * Close a card that nobody filled. Expires any pending offers, moves the card to "Expired / manual"
 * and alerts reception.
 */
export async function giveUp(
  deps: EngineDeps,
  pipelineId: string,
  reason: string,
  triggeredBy: Actor = "engine",
  preloaded?: Loaded,
): Promise<OfferRun> {
  const now = nowOf(deps);
  const loaded = preloaded ?? (await loadPipeline(deps.db, pipelineId));
  if (!loaded) return { status: "skipped", reason: "Card not found." };
  const { pipeline, event, clinic } = loaded;
  if (!isOpenStage(pipeline.stage)) return { status: "skipped", reason: "This card is already closed." };

  await deps.db.from("waitlist_offers").update({ response: "expired" }).eq("pipeline_id", pipeline.id).eq("response", "pending");
  const offers = await offersSoFar(deps, pipeline.id);

  const text = `Expired: ${reason}.`;
  try {
    await transitionStage(deps.db, {
      pipeline: { id: pipeline.id, stage: pipeline.stage },
      to: "expired_manual",
      triggeredBy,
      note: text,
      fields: { notes: reason.charAt(0).toUpperCase() + reason.slice(1) },
      now,
    });
  } catch (error) {
    if (error instanceof ApiError) return { status: "skipped", reason: error.message };
    throw error;
  }

  try {
    await deps.notifier.slotExpired({
      clinic: clinicInfo(clinic),
      slot: slotInfo(event),
      pipelineId: pipeline.id,
      reason,
      offeredCount: offers.length,
    });
  } catch (error) {
    console.error("Expired-slot alert failed:", error instanceof Error ? error.message : error);
  }
  return { status: "gave_up", reason };
}

/**
 * After a NO or an expired offer: offer the next patient, unless an offer for this slot is still open
 * (batch mode), the card has moved on, or nobody is left.
 */
export async function advance(deps: EngineDeps, pipelineId: string, triggeredBy: Actor = "engine"): Promise<OfferRun> {
  const now = nowOf(deps);
  const loaded = await loadPipeline(deps.db, pipelineId);
  if (!loaded) return { status: "skipped", reason: "Card not found." };
  if (loaded.pipeline.stage !== "offer_sent") return { status: "skipped", reason: "No offer is waiting for an answer." };

  const offers = await offersSoFar(deps, pipelineId);
  const stillOpen = offers.some(
    (o) => o.response === "pending" && (!o.offer_expires_at || new Date(o.offer_expires_at).getTime() >= now.getTime()),
  );
  if (stillOpen) return { status: "skipped", reason: "Another offer for this slot is still open." };

  return offerNext(deps, pipelineId, triggeredBy, loaded);
}
