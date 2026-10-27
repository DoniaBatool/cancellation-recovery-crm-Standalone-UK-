import { loadPipeline, nowOf, type EngineDeps } from "@/lib/engine/context";
import { advance } from "@/lib/engine/offer";
import { respondToOffer } from "@/lib/engine/respond";
import { logHistory } from "@/lib/pipeline";
import { parseSmsReply } from "@/lib/sms-reply";
import { noReceivedSms, startSms, stopSms, tooLateSms, unknownReplySms, yesReceivedSms } from "@/lib/sms-templates";

// A patient's text reply. Source: SYSTEM_BUILD_GUIDE.md §7 E5.
// Returns the text to send back (as TwiML), or null for an empty reply.

export type InboundSms = { from: string; body: string; messageSid: string };

export async function handleInboundSms(deps: EngineDeps, sms: InboundSms): Promise<{ reply: string | null }> {
  const now = nowOf(deps);

  // Everyone on a waitlist with this number (family members can share one).
  const { data: rows } = await deps.db.from("waitlist").select("id, clinic_id, sms_opt_out").eq("phone", sms.from);
  const patients = rows ?? [];
  const first = patients[0];
  if (!first) return { reply: null }; // not one of our patients: nothing to attach it to

  const { data: clinic } = await deps.db.from("clinics").select("name").eq("id", first.clinic_id).maybeSingle();
  const clinicName = clinic?.name ?? "the practice";

  // Log it. A repeated MessageSid (Twilio retries) hits the unique index and is ignored.
  const { error: logError } = await deps.db.from("messages").insert({
    clinic_id: first.clinic_id,
    waitlist_patient_id: first.id,
    channel: "sms",
    direction: "in",
    to_or_from: sms.from,
    body: sms.body,
    provider_id: sms.messageSid,
    status: "received",
  });
  if (logError) {
    const duplicate = /duplicate|unique/i.test(logError.message ?? "") || (logError as { code?: string }).code === "23505";
    if (duplicate) return { reply: null };
    console.error("Could not log inbound SMS:", logError.message);
  }

  const ids = patients.map((p) => p.id);
  const kind = parseSmsReply(sms.body);

  // Offers for these people, newest first.
  const { data: offerRows } = await deps.db
    .from("waitlist_offers")
    .select("id, pipeline_id, waitlist_patient_id, response, offer_token, offer_expires_at, offered_at")
    .in("waitlist_patient_id", ids);
  const offers = (offerRows ?? []).slice().sort((a, b) => (a.offered_at < b.offered_at ? 1 : a.offered_at > b.offered_at ? -1 : 0));
  const open = offers.filter((o) => o.response === "pending" && (!o.offer_expires_at || new Date(o.offer_expires_at).getTime() >= now.getTime()));

  if (kind === "stop") {
    await deps.db.from("waitlist").update({ sms_opt_out: true, sms_opt_out_at: now.toISOString(), is_active: false }).in("id", ids);
    const touched = new Set<string>();
    for (const offer of offers.filter((o) => o.response === "pending")) {
      const { data: done } = await deps.db
        .from("waitlist_offers")
        .update({ response: "declined", responded_at: now.toISOString(), responded_via: "sms_reply" })
        .eq("id", offer.id)
        .eq("response", "pending")
        .select("id");
      if (done && done.length > 0) touched.add(offer.pipeline_id);
    }
    for (const pipelineId of touched) {
      await logHistory(deps.db, { id: pipelineId, stage: "offer_sent" }, "Patient replied STOP and was removed from the waitlist.", "patient");
      await advance(deps, pipelineId, "engine");
    }
    return { reply: stopSms(clinicName) };
  }

  if (kind === "start") {
    await deps.db.from("waitlist").update({ sms_opt_out: false, sms_opt_out_at: null, is_active: true }).in("id", ids);
    return { reply: startSms(clinicName) };
  }

  if (kind === "yes" || kind === "no") {
    const target = open[0]; // the most recent open offer (the link is the precise path for shared phones)
    if (!target?.offer_token) return { reply: tooLateSms() };
    const result = await respondToOffer(deps, target.offer_token, kind === "yes" ? "accepted" : "declined", "sms_reply");
    if (result.state === "accepted") return { reply: yesReceivedSms(clinicName) };
    if (result.state === "declined") return { reply: noReceivedSms() };
    return { reply: tooLateSms() };
  }

  // Anything else: leave a note for reception on the latest card.
  const latest = offers[0];
  if (latest) {
    const loaded = await loadPipeline(deps.db, latest.pipeline_id);
    if (loaded) await logHistory(deps.db, loaded.pipeline, `Patient replied: "${sms.body.slice(0, 200)}"`, "patient");
  }
  return { reply: unknownReplySms() };
}

/**
 * Twilio delivery report. Updates the message row and, when the text failed and the patient had no
 * email either, leaves a note so reception calls them.
 */
export async function handleSmsStatus(
  deps: EngineDeps,
  report: { messageSid: string; status: string; errorCode?: string | null },
): Promise<void> {
  const failed = report.status === "failed" || report.status === "undelivered";
  const { data: updated } = await deps.db
    .from("messages")
    .update({ status: report.status, error: failed ? `Twilio error ${report.errorCode ?? "unknown"}` : null })
    .eq("provider_id", report.messageSid)
    .select("id, pipeline_id, offer_id, channel, direction");
  const message = updated?.[0];
  if (!failed || !message || message.direction !== "out" || !message.pipeline_id) return;

  // Did an email for the same offer go out? Then the patient can still answer.
  if (message.offer_id) {
    const { data: siblings } = await deps.db.from("messages").select("channel, status").eq("offer_id", message.offer_id).eq("direction", "out");
    if ((siblings ?? []).some((m) => m.channel === "email" && m.status === "sent")) return;
  }
  const loaded = await loadPipeline(deps.db, message.pipeline_id);
  if (loaded) await logHistory(deps.db, loaded.pipeline, "SMS failed — call patient.", "engine");
}
