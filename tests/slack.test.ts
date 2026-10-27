import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { approvalBlocks, closeMessage, parseSlackAction, postApproval, verifySlackSignature } from "@/lib/slack";

const SECRET = "test-signing-secret";
const NOW = new Date("2026-10-26T10:00:00Z");
const ts = String(Math.floor(NOW.getTime() / 1000));
const sign = (body: string, t = ts) => `v0=${createHmac("sha256", SECRET).update(`v0:${t}:${body}`).digest("hex")}`;

describe("verifySlackSignature", () => {
  const body = "payload=%7B%7D";
  it("accepts a correct signature", () => {
    expect(verifySlackSignature({ signingSecret: SECRET, timestamp: ts, signature: sign(body), rawBody: body, now: NOW })).toBe(true);
  });
  it("rejects a wrong signature, wrong body, or missing headers", () => {
    expect(verifySlackSignature({ signingSecret: SECRET, timestamp: ts, signature: sign("other"), rawBody: body, now: NOW })).toBe(false);
    expect(verifySlackSignature({ signingSecret: "x", timestamp: ts, signature: sign(body), rawBody: body, now: NOW })).toBe(false);
    expect(verifySlackSignature({ signingSecret: SECRET, timestamp: null, signature: sign(body), rawBody: body, now: NOW })).toBe(false);
    expect(verifySlackSignature({ signingSecret: SECRET, timestamp: ts, signature: null, rawBody: body, now: NOW })).toBe(false);
    expect(verifySlackSignature({ signingSecret: SECRET, timestamp: "abc", signature: sign(body), rawBody: body, now: NOW })).toBe(false);
  });
  it("rejects a timestamp older than 5 minutes (replay)", () => {
    const old = String(Math.floor(NOW.getTime() / 1000) - 301);
    expect(verifySlackSignature({ signingSecret: SECRET, timestamp: old, signature: sign(body, old), rawBody: body, now: NOW })).toBe(false);
    const ok = String(Math.floor(NOW.getTime() / 1000) - 299);
    expect(verifySlackSignature({ signingSecret: SECRET, timestamp: ok, signature: sign(body, ok), rawBody: body, now: NOW })).toBe(true);
  });
});

const PID = "11111111-1111-4111-8111-111111111111";
const TOK = "22222222-2222-4222-8222-222222222222";

describe("approvalBlocks", () => {
  it("has Approve and Offer to next buttons carrying pipeline id and token", () => {
    const { blocks, text } = approvalBlocks({
      timeZone: "Europe/London", patientName: "Sarah Khan", patientPhone: "+447700900001", procedure: "Crown",
      dentist: "Dr Ali", slotDatetime: "2026-10-27T14:30:00Z", price: 650, pipelineId: PID, approvalToken: TOK,
    });
    expect(text).toContain("Sarah Khan said YES");
    const actions = blocks.find((b) => b.type === "actions") as { elements: { value: string }[] };
    expect(actions.elements.map((e) => e.value)).toEqual([`approve:${PID}:${TOK}`, `next:${PID}:${TOK}`]);
    expect(JSON.stringify(blocks)).toContain("£650");
  });
});

describe("parseSlackAction", () => {
  const payload = (value: string) => ({
    type: "block_actions",
    user: { id: "U1", name: "sam" },
    message: { ts: "1.2", blocks: [{ text: { text: "details" } }] },
    actions: [{ value }],
  });
  it("reads a valid approve click", () => {
    expect(parseSlackAction(payload(`approve:${PID}:${TOK}`))).toEqual({
      kind: "approve", pipelineId: PID, token: TOK, userId: "U1", userName: "sam", messageTs: "1.2", responseUrl: null, originalText: "details",
    });
  });
  it("rejects malformed values and other payload types", () => {
    expect(parseSlackAction(payload("approve:nope:nope"))).toBeNull();
    expect(parseSlackAction(payload(`delete:${PID}:${TOK}`))).toBeNull();
    expect(parseSlackAction(payload(`approve:${PID}:${TOK}:extra`))).toBeNull();
    expect(parseSlackAction({ type: "view_submission" })).toBeNull();
    expect(parseSlackAction(null)).toBeNull();
    expect(parseSlackAction({ type: "block_actions", actions: [] })).toBeNull();
  });
});

describe("postApproval / closeMessage", () => {
  const config = { botToken: "xoxb-test", signingSecret: SECRET, channelId: "C1" };
  const input = {
    timeZone: "Europe/London", patientName: "Sarah Khan", patientPhone: null, procedure: null, dentist: null,
    slotDatetime: "2026-10-27T14:30:00Z", price: null, pipelineId: PID, approvalToken: TOK,
  };
  it("returns the message ts on success and sends the bot token", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ json: async () => ({ ok: true, ts: "99.9" }) });
    expect(await postApproval(config, input, fetchImpl as unknown as typeof fetch)).toBe("99.9");
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://slack.com/api/chat.postMessage");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer xoxb-test" });
  });
  it("returns null (not throw) when Slack errors or the network fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await postApproval(config, input, vi.fn().mockResolvedValue({ json: async () => ({ ok: false, error: "channel_not_found" }) }) as unknown as typeof fetch)).toBeNull();
    expect(await postApproval(config, input, vi.fn().mockRejectedValue(new Error("down")) as unknown as typeof fetch)).toBeNull();
    spy.mockRestore();
  });
  it("closes a message with chat.update", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ json: async () => ({ ok: true }) });
    expect(await closeMessage(config, "99.9", "", "✅ Approved by Sam", fetchImpl as unknown as typeof fetch)).toBe(true);
    expect(fetchImpl.mock.calls[0]![0]).toBe("https://slack.com/api/chat.update");
    expect(JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string)).toMatchObject({ channel: "C1", ts: "99.9" });
  });
});
