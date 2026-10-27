import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createSmsSender, twiml, verifyTwilioSignature } from "@/lib/sms";
import { memoryDb } from "./helpers/memory-db";

const base = { accountSid: "AC1", authToken: "secret-token", messagingServiceSid: null, smsFrom: "+447000000000", whatsappFrom: null };
const input = { to: "+447700900001", body: "hello", clinicId: "c1", pipelineId: "p1", offerId: "o1", patientId: "w1" };

describe("createSmsSender", () => {
  it("sends with from, a status callback, and logs the message", async () => {
    const store = memoryDb({});
    const create = vi.fn().mockResolvedValue({ sid: "SM1", status: "queued" });
    const ok = await createSmsSender(base, store.db, "https://app.example.com", { messages: { create } }).send(input);
    expect(ok).toBe(true);
    expect(create).toHaveBeenCalledWith({ to: "+447700900001", body: "hello", from: "+447000000000", statusCallback: "https://app.example.com/api/webhooks/twilio/status" });
    expect(store.tables.messages![0]).toMatchObject({ channel: "sms", direction: "out", provider_id: "SM1", status: "queued", offer_id: "o1" });
  });

  it("prefers the messaging service when both are set", async () => {
    const create = vi.fn().mockResolvedValue({ sid: "SM1" });
    await createSmsSender({ ...base, messagingServiceSid: "MG1" }, memoryDb({}).db, "https://a.co", { messages: { create } }).send(input);
    expect(create.mock.calls[0]![0]).toMatchObject({ messagingServiceSid: "MG1" });
    expect(create.mock.calls[0]![0]).not.toHaveProperty("from");
  });

  it("never throws: returns false and logs a failed row", async () => {
    const store = memoryDb({});
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const create = vi.fn().mockRejectedValue(new Error("invalid number"));
    expect(await createSmsSender(base, store.db, "https://a.co", { messages: { create } }).send(input)).toBe(false);
    expect(store.tables.messages![0]).toMatchObject({ status: "failed", error: "invalid number", provider_id: null });
    expect(spy.mock.calls.flat().join(" ")).not.toContain("+447700900001");
    spy.mockRestore();
  });
});

describe("verifyTwilioSignature", () => {
  const url = "https://app.example.com/api/webhooks/twilio/inbound";
  const params = { From: "+447700900001", Body: "YES", MessageSid: "SM9" };
  // Twilio's algorithm: HMAC-SHA1 of url + sorted key/value pairs, base64.
  const sign = (token: string) =>
    createHmac("sha1", token).update(url + Object.keys(params).sort().map((k) => k + params[k as keyof typeof params]).join("")).digest("base64");

  it("accepts a valid signature", () => {
    expect(verifyTwilioSignature({ authToken: "tok", signature: sign("tok"), url, params })).toBe(true);
  });
  it("rejects wrong token, tampered params, other URL, and missing signature", () => {
    expect(verifyTwilioSignature({ authToken: "other", signature: sign("tok"), url, params })).toBe(false);
    expect(verifyTwilioSignature({ authToken: "tok", signature: sign("tok"), url, params: { ...params, Body: "NO" } })).toBe(false);
    expect(verifyTwilioSignature({ authToken: "tok", signature: sign("tok"), url: url + "x", params })).toBe(false);
    expect(verifyTwilioSignature({ authToken: "tok", signature: null, url, params })).toBe(false);
  });
});

describe("twiml", () => {
  it("is empty for no message and escapes special characters", () => {
    expect(twiml(null)).toContain("<Response/>");
    expect(twiml("a < b & c")).toContain("<Message>a &lt; b &amp; c</Message>");
  });
});
