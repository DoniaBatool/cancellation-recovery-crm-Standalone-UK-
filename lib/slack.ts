import { createHmac } from "node:crypto";
import { safeEqual } from "@/lib/api/auth";
import { formatGBP, formatSlot } from "@/lib/format";

// Slack front-desk approval. Source: SYSTEM_BUILD_GUIDE.md §7 E6.
// Block Kit message with Approve / Offer to next buttons, signature check, and chat.update.

export type SlackConfig = { botToken: string; signingSecret: string; channelId: string };
type FetchLike = typeof fetch;

const MAX_AGE_SECONDS = 5 * 60;

/** Verify X-Slack-Signature: v0= + HMAC-SHA256(secret, `v0:${timestamp}:${rawBody}`), max 5 min old. */
export function verifySlackSignature(input: {
  signingSecret: string;
  timestamp: string | null;
  signature: string | null;
  rawBody: string;
  now?: Date;
}): boolean {
  const { signingSecret, timestamp, signature, rawBody } = input;
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - Number(timestamp)) > MAX_AGE_SECONDS) return false;
  const expected = `v0=${createHmac("sha256", signingSecret).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;
  return safeEqual(expected, signature);
}

export type ApprovalMessageInput = {
  timeZone: string;
  patientName: string;
  patientPhone: string | null;
  procedure: string | null;
  dentist: string | null;
  slotDatetime: string;
  price: number | null;
  pipelineId: string;
  approvalToken: string;
};

type Block = Record<string, unknown>;

/** Block Kit blocks for the "patient said YES" message. */
export function approvalBlocks(i: ApprovalMessageInput): { text: string; blocks: Block[] } {
  const when = formatSlot(i.slotDatetime, i.timeZone);
  const text = `${i.patientName} said YES to ${when}. Approve?`;
  const details = [
    `*${i.patientName}* said YES${i.patientPhone ? ` (${i.patientPhone})` : ""}`,
    `Slot: ${when}`,
    `Treatment: ${i.procedure ?? "Not specified"}`,
    `Dentist: ${i.dentist ?? "Not specified"}`,
    ...(i.price !== null ? [`Value: ${formatGBP(i.price)}`] : []),
  ].join("\n");
  return {
    text,
    blocks: [
      { type: "section", text: { type: "mrkdwn", text: details } },
      {
        type: "actions",
        block_id: "approval",
        elements: [
          {
            type: "button",
            style: "primary",
            text: { type: "plain_text", text: "Approve" },
            action_id: "approve",
            value: `approve:${i.pipelineId}:${i.approvalToken}`,
          },
          {
            type: "button",
            text: { type: "plain_text", text: "Offer to next" },
            action_id: "next",
            value: `next:${i.pipelineId}:${i.approvalToken}`,
          },
        ],
      },
    ],
  };
}

/** Blocks for a closed message: the buttons are gone. */
export function resolvedBlocks(original: string, text: string): { text: string; blocks: Block[] } {
  return {
    text,
    blocks: [
      ...(original ? [{ type: "section", text: { type: "mrkdwn", text: original } }] : []),
      { type: "section", text: { type: "mrkdwn", text } },
    ],
  };
}

async function slackCall(config: SlackConfig, method: string, body: Record<string, unknown>, fetchImpl: FetchLike) {
  const response = await fetchImpl(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${config.botToken}` },
    body: JSON.stringify(body),
  });
  const json = (await response.json()) as { ok?: boolean; ts?: string; error?: string };
  return json;
}

/** Post the approval message. Returns the message ts, or null if it failed. Never throws. */
export async function postApproval(config: SlackConfig, input: ApprovalMessageInput, fetchImpl: FetchLike = fetch): Promise<string | null> {
  try {
    const { text, blocks } = approvalBlocks(input);
    const json = await slackCall(config, "chat.postMessage", { channel: config.channelId, text, blocks }, fetchImpl);
    if (!json.ok || !json.ts) {
      console.error("Slack post failed:", json.error ?? "unknown");
      return null;
    }
    return json.ts;
  } catch (error) {
    console.error("Slack post failed:", error instanceof Error ? error.message : error);
    return null;
  }
}

/** Replace a message with a closed version (no buttons). Never throws. */
export async function closeMessage(
  config: SlackConfig,
  ts: string,
  original: string,
  text: string,
  fetchImpl: FetchLike = fetch,
): Promise<boolean> {
  try {
    const { blocks } = resolvedBlocks(original, text);
    const json = await slackCall(config, "chat.update", { channel: config.channelId, ts, text, blocks }, fetchImpl);
    if (!json.ok) console.error("Slack update failed:", json.error ?? "unknown");
    return Boolean(json.ok);
  } catch (error) {
    console.error("Slack update failed:", error instanceof Error ? error.message : error);
    return false;
  }
}

export type SlackAction = {
  kind: "approve" | "next";
  pipelineId: string;
  token: string;
  userId: string;
  userName: string;
  messageTs: string | null;
  responseUrl: string | null;
  /** Plain text of the first block, so the closed message keeps the details. */
  originalText: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Read a Slack interactivity payload (already JSON-parsed). Returns null for anything unexpected. */
export function parseSlackAction(payload: unknown): SlackAction | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, any>;
  if (p.type !== "block_actions" || !Array.isArray(p.actions) || p.actions.length === 0) return null;
  const value = String(p.actions[0]?.value ?? "");
  const [kind, pipelineId, token, ...rest] = value.split(":");
  if ((kind !== "approve" && kind !== "next") || rest.length > 0) return null;
  if (!pipelineId || !UUID.test(pipelineId) || !token || !UUID.test(token)) return null;
  const user = p.user ?? {};
  const userId = String(user.id ?? "");
  if (!userId) return null;
  return {
    kind,
    pipelineId,
    token,
    userId,
    userName: String(user.name ?? user.username ?? userId),
    messageTs: typeof p.message?.ts === "string" ? p.message.ts : null,
    responseUrl: typeof p.response_url === "string" ? p.response_url : null,
    originalText: String(p.message?.blocks?.[0]?.text?.text ?? p.message?.text ?? ""),
  };
}

/** Slack only lets us reply to an interaction through https://hooks.slack.com/... Anything else is ignored. */
export function isSlackResponseUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "hooks.slack.com";
  } catch {
    return false;
  }
}

/** Reply only to the person who pressed the button ("Already approved"). Never throws. */
export async function replyEphemeral(responseUrl: string, text: string, fetchImpl: FetchLike = fetch): Promise<void> {
  if (!isSlackResponseUrl(responseUrl)) return;
  try {
    await fetchImpl(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ response_type: "ephemeral", replace_original: false, text }),
    });
  } catch (error) {
    console.error("Slack reply failed:", error instanceof Error ? error.message : error);
  }
}
