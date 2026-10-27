import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { handleSlackAction } from "@/lib/engine/slack-actions";
import { NOW, makeWorld } from "./helpers/engine-world";

const SECRET = "slack-secret";
const slack = { botToken: "t", signingSecret: SECRET, channelId: "C1" };
const TOKEN = "33333333-3333-4333-8333-333333333333";
const PID = "44444444-4444-4444-8444-444444444444";
const waiting = {
  id: PID,
  stage: "waiting_staff_approval",
  waitlist_patient_id: "a",
  approval_token: TOKEN,
  approval_token_expires_at: "2026-10-26T10:30:00Z",
  slack_message_ts: "55.5",
};
const offers = [{ id: "o1", pipeline_id: PID, waitlist_patient_id: "a", response: "accepted", offer_token: "t1" }];

function request(kind: string, over: { token?: string; pipelineId?: string; signWith?: string; userName?: string } = {}) {
  const payload = {
    type: "block_actions",
    user: { id: "U1", name: over.userName ?? "sam" },
    message: { ts: "55.5", blocks: [{ text: { text: "details" } }] },
    response_url: "https://hooks.slack.com/actions/T/B/x",
    actions: [{ value: `${kind}:${over.pipelineId ?? PID}:${over.token ?? TOKEN}` }],
  };
  const rawBody = `payload=${encodeURIComponent(JSON.stringify(payload))}`;
  const timestamp = String(Math.floor(NOW.getTime() / 1000));
  const signature = `v0=${createHmac("sha256", over.signWith ?? SECRET).update(`v0:${timestamp}:${rawBody}`).digest("hex")}`;
  return { rawBody, timestamp, signature, slack, now: NOW };
}

describe("handleSlackAction", () => {
  it("rejects a bad signature without touching the card", async () => {
    const w = makeWorld({ pipeline: waiting, offers });
    const res = await handleSlackAction({ ...request("approve", { signWith: "wrong" }), deps: w.deps });
    expect(res.status).toBe(401);
    expect(w.pipeline().stage).toBe("waiting_staff_approval");
  });

  it("rejects an unreadable payload", async () => {
    const w = makeWorld({ pipeline: waiting, offers });
    const r = request("approve");
    const rawBody = "payload=not-json";
    const signature = `v0=${createHmac("sha256", SECRET).update(`v0:${r.timestamp}:${rawBody}`).digest("hex")}`;
    expect((await handleSlackAction({ ...r, rawBody, signature, deps: w.deps })).status).toBe(400);
  });

  it("Approve: recovers the slot, approved_by stays null, history names the Slack user", async () => {
    const w = makeWorld({ pipeline: waiting, offers });
    const res = await handleSlackAction({ ...request("approve"), deps: w.deps });
    expect(res.status).toBe(200);
    expect(w.pipeline()).toMatchObject({ stage: "slot_recovered", approved_by: null, revenue_saved: 150 });
    expect(w.history()).toContain("Approved in Slack by sam.");
    expect(w.notifier.approvalResolved).toHaveBeenCalledWith(expect.objectContaining({ text: "✅ Approved by sam" }));
  });

  it("runs the confirmation emails after the reply when a defer function is given", async () => {
    const w = makeWorld({ pipeline: waiting, offers });
    const tasks: (() => Promise<void>)[] = [];
    await handleSlackAction({ ...request("approve"), deps: { ...w.deps, defer: (t) => tasks.push(t) } });
    expect(w.notifier.confirmation).not.toHaveBeenCalled();
    expect(w.pipeline().stage).toBe("slot_recovered");
    await tasks[0]!();
    expect(w.notifier.confirmation).toHaveBeenCalledTimes(1);
  });

  it("Offer to next: passes the card on", async () => {
    const w = makeWorld({ pipeline: waiting, offers });
    await handleSlackAction({ ...request("next"), deps: w.deps });
    expect(w.pipeline().stage).toBe("offer_sent");
    expect(w.sentOffers).toHaveLength(1);
  });

  it("ignores a token that does not match the card", async () => {
    const w = makeWorld({ pipeline: waiting, offers });
    const fetchImpl = vi.fn().mockResolvedValue({});
    const res = await handleSlackAction({ ...request("approve", { token: "55555555-5555-4555-8555-555555555555" }), deps: w.deps, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(res.status).toBe(200);
    expect(w.pipeline().stage).toBe("waiting_staff_approval");
    expect(JSON.parse(fetchImpl.mock.calls[0]![1].body).text).toBe("This button is no longer valid.");
  });

  it("a second tap says Already approved and does not approve twice", async () => {
    const w = makeWorld({ pipeline: { ...waiting, stage: "slot_recovered" }, offers });
    const fetchImpl = vi.fn().mockResolvedValue({});
    await handleSlackAction({ ...request("approve"), deps: w.deps, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(JSON.parse(fetchImpl.mock.calls[0]![1].body).text).toBe("Already approved.");
    expect(w.notifier.confirmation).not.toHaveBeenCalled();
  });

  it("Offer to next on a card that moved on does nothing and tells the user", async () => {
    const w = makeWorld({ pipeline: { ...waiting, stage: "expired_manual" }, offers });
    const fetchImpl = vi.fn().mockResolvedValue({});
    const res = await handleSlackAction({ ...request("next"), deps: w.deps, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(res.status).toBe(200);
    expect(JSON.parse(fetchImpl.mock.calls[0]![1].body).text).toContain("moved on");
  });

  it("only replies through hooks.slack.com", async () => {
    const w = makeWorld({ pipeline: { ...waiting, stage: "slot_recovered" }, offers });
    const r = request("approve");
    const payload = JSON.parse(decodeURIComponent(r.rawBody.slice(8)));
    payload.response_url = "https://evil.example.com/steal";
    const rawBody = `payload=${encodeURIComponent(JSON.stringify(payload))}`;
    const signature = `v0=${createHmac("sha256", SECRET).update(`v0:${r.timestamp}:${rawBody}`).digest("hex")}`;
    const fetchImpl = vi.fn();
    await handleSlackAction({ ...r, rawBody, signature, deps: w.deps, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
