import { after } from "next/server";
import { getEnv } from "@/lib/env";
import { handleDentallyWebhook } from "@/lib/engine/dentally-intake";
import { getDentallyClient, getEngineDeps } from "@/lib/engine/runtime";

// Dentally webhook. Auth: the secret in the path (compared in constant time). Source: guide §7 E2.
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

  let payload: unknown = null;
  try {
    payload = await request.json();
  } catch {
    // an unreadable body is ignored, but still answered with 200
  }

  const result = await handleDentallyWebhook({
    secretFromPath: secret,
    expectedSecret: expected,
    payload,
    deps: { ...deps, defer: (task) => after(task) },
    client: getDentallyClient(),
  });
  return new Response(result.status === 200 ? "ok" : "Not found.", { status: result.status });
}
