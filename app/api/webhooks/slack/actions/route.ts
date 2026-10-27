import { after } from "next/server";
import { getEnv } from "@/lib/env";
import { handleSlackAction } from "@/lib/engine/slack-actions";
import { getEngineDeps } from "@/lib/engine/runtime";

// Slack interactivity URL. Auth: X-Slack-Signature (checked inside handleSlackAction).
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  let slack;
  try {
    slack = getEnv().slack;
  } catch {
    slack = null;
  }
  const deps = getEngineDeps();
  if (!slack || !deps) return new Response("Slack is not set up.", { status: 404 });

  const rawBody = await request.text();
  const result = await handleSlackAction({
    rawBody,
    timestamp: request.headers.get("x-slack-request-timestamp"),
    signature: request.headers.get("x-slack-signature"),
    slack,
    deps: { ...deps, defer: (task) => after(task) },
  });
  return new Response(result.status === 200 ? "" : result.status === 401 ? "Invalid signature." : "Bad request.", { status: result.status });
}
