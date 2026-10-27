import { handleSmsStatus } from "@/lib/engine/inbound-sms";
import { getEngineDeps } from "@/lib/engine/runtime";
import { readSignedTwilioForm } from "@/lib/twilio-webhook";

// Twilio delivery reports. Auth: X-Twilio-Signature. Source: guide §7 E4.
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const signed = await readSignedTwilioForm(request, "/api/webhooks/twilio/status");
  if ("response" in signed) return signed.response;
  const { MessageSid, MessageStatus, ErrorCode } = signed.params;
  if (!MessageSid || !MessageStatus) return new Response("Bad request.", { status: 400 });

  const deps = getEngineDeps();
  if (!deps) return new Response("Not configured.", { status: 503 });
  try {
    await handleSmsStatus(deps, { messageSid: MessageSid, status: MessageStatus, errorCode: ErrorCode ?? null });
  } catch (error) {
    console.error("SMS status failed:", error instanceof Error ? error.message : error);
  }
  return new Response("", { status: 200 });
}
