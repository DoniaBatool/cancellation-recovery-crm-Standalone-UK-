import { getEnv } from "@/lib/env";
import { verifyTwilioSignature } from "@/lib/sms";

// Shared start of the two Twilio webhooks: configured? signed correctly? Returns the form fields.
// The signature is checked against the EXACT public URL that is set in Twilio (NEXT_PUBLIC_APP_URL + path).

export async function readSignedTwilioForm(
  request: Request,
  path: "/api/webhooks/twilio/inbound" | "/api/webhooks/twilio/status",
): Promise<{ params: Record<string, string> } | { response: Response }> {
  let env;
  try {
    env = getEnv();
  } catch {
    return { response: new Response("Not configured.", { status: 503 }) };
  }
  if (!env.twilio) return { response: new Response("SMS is not set up.", { status: 404 }) };

  const form = await request.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of form.entries()) if (typeof value === "string") params[key] = value;

  const ok = verifyTwilioSignature({
    authToken: env.twilio.authToken,
    signature: request.headers.get("x-twilio-signature"),
    url: `${env.appUrl}${path}`,
    params,
  });
  if (!ok) return { response: new Response("Invalid signature.", { status: 403 }) };
  return { params };
}
