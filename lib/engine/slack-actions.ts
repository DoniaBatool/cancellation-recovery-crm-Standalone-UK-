import { safeEqual } from "@/lib/api/auth";
import { ApiError } from "@/lib/api/http";
import { approveBooking, offerToNext, type ApprovalActor } from "@/lib/engine/approve";
import { loadPipeline, type EngineDeps } from "@/lib/engine/context";
import { parseSlackAction, replyEphemeral, verifySlackSignature, type SlackConfig } from "@/lib/slack";

// A Slack button click. Source: SYSTEM_BUILD_GUIDE.md §7 E6.
// Order: verify the signature, check the token matches the card, do the stage change, answer 200,
// and let the slow work (confirmation emails) run afterwards through deps.defer.

export type SlackActionInput = {
  rawBody: string;
  timestamp: string | null;
  signature: string | null;
  slack: SlackConfig;
  deps: EngineDeps;
  fetchImpl?: typeof fetch;
  now?: Date;
};

export type SlackActionResult = { status: 200 | 400 | 401 };

export async function handleSlackAction(input: SlackActionInput): Promise<SlackActionResult> {
  const { rawBody, slack, deps } = input;
  if (!verifySlackSignature({ signingSecret: slack.signingSecret, timestamp: input.timestamp, signature: input.signature, rawBody, now: input.now })) {
    return { status: 401 };
  }

  let action;
  try {
    const payload = new URLSearchParams(rawBody).get("payload");
    action = payload ? parseSlackAction(JSON.parse(payload)) : null;
  } catch {
    action = null;
  }
  if (!action) return { status: 400 };

  const tell = (text: string) => (action.responseUrl ? replyEphemeral(action.responseUrl, text, input.fetchImpl) : Promise.resolve());

  const loaded = await loadPipeline(deps.db, action.pipelineId);
  // A token that does not match the card is treated like an unknown button: nothing happens.
  if (!loaded || !loaded.pipeline.approval_token || !safeEqual(loaded.pipeline.approval_token, action.token)) {
    await tell("This button is no longer valid.");
    return { status: 200 };
  }

  const actor: ApprovalActor = { kind: "slack", label: action.userName };
  try {
    if (action.kind === "approve") {
      const result = await approveBooking(deps, action.pipelineId, actor);
      if (result.status === "already_confirmed") await tell("Already approved.");
    } else {
      await offerToNext(deps, action.pipelineId, actor);
    }
  } catch (error) {
    if (error instanceof ApiError) {
      await tell(loaded.pipeline.stage === "slot_recovered" ? "Already approved." : "This card has moved on, so nothing was changed.");
    } else {
      console.error("Slack action failed:", error instanceof Error ? error.message : error);
      await tell("Something went wrong. Please use the CRM.");
    }
  }
  return { status: 200 };
}
