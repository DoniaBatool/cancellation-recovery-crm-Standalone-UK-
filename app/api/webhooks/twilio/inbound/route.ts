import { handleInboundSms } from "@/lib/engine/inbound-sms";
import { getEngineDeps } from "@/lib/engine/runtime";
import { checkRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import { twiml } from "@/lib/sms";
import { readSignedTwilioForm } from "@/lib/twilio-webhook";

// Patient text replies (YES / NO / STOP / other). Auth: X-Twilio-Signature. Source: guide §7 E5.
export const dynamic = "force-dynamic";

const XML = { "Content-Type": "text/xml; charset=utf-8" };

export async function POST(request: Request): Promise<Response> {
  const signed = await readSignedTwilioForm(request, "/api/webhooks/twilio/inbound");
  if ("response" in signed) return signed.response;
  const { From, Body, MessageSid } = signed.params;
  if (!From || !MessageSid) return new Response("Bad request.", { status: 400 });

  const deps = getEngineDeps();
  if (!deps) return new Response("Not configured.", { status: 503 });
  // Loop protection: one phone number cannot make us process unlimited texts. Silent (no reply) when over.
  if (!(await checkRateLimit(deps.db, RATE_LIMITS.smsInbound, From))) {
    return new Response(twiml(null), { status: 200, headers: XML });
  }
  try {
    const { reply } = await handleInboundSms(deps, { from: From, body: Body ?? "", messageSid: MessageSid });
    return new Response(twiml(reply), { status: 200, headers: XML });
  } catch (error) {
    // Answer with an empty reply: Twilio would otherwise retry and the patient could get two texts.
    console.error("Inbound SMS failed:", error instanceof Error ? error.message : error);
    return new Response(twiml(null), { status: 200, headers: XML });
  }
}
