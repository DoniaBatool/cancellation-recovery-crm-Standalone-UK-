import { after } from "next/server";
import { DENTALLY_SIGNATURE_HEADER } from "@/lib/dentally/signature";
import { getEnv } from "@/lib/env";
import { handleDentallyWebhook } from "@/lib/engine/dentally-intake";
import { getDentallyClient, getEngineDeps } from "@/lib/engine/runtime";

// Dentally webhook. Auth: the secret in the path, then the X-Dentally-Signature HMAC (both compared in constant time). Source: guide §7 E2.
// Always answers 200 quickly (even for events we ignore): Dentally switches a webhook off after 50 failed deliveries.
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ secret: string }> }): Promise<Response> {
  const { secret } = await params;
  let expected: string | null = null;
  try {
    expected = getEnv().dentallyWebhookSecret;
  } catch {
    // not configured
  }
  const deps = getEngineDeps();
  if (!deps) return new Response("Not configured.", { status: 503 });

  const rawBody = await request.text();

  const result = await handleDentallyWebhook({
    secretFromPath: secret,
    expectedSecret: expected,
    rawBody,
    signature: request.headers.get(DENTALLY_SIGNATURE_HEADER),
    deps: { ...deps, defer: (task) => after(task) },
    client: getDentallyClient(),
  });
  return new Response(result.status === 200 ? "ok" : "Not found.", { status: result.status });
}
