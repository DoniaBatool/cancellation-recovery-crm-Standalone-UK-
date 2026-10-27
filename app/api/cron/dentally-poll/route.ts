import { requireBearer } from "@/lib/api/auth";
import { ApiError, jsonOk, withApi } from "@/lib/api/http";
import { getEnv } from "@/lib/env";
import { runDentallyPoll } from "@/lib/engine/dentally-intake";
import { getDentallyClient, getEngineDeps } from "@/lib/engine/runtime";

// Every 5 minutes: the safety net for missed webhooks. Auth: Bearer CRON_SECRET.
export const dynamic = "force-dynamic";

export const GET = withApi(async (request) => {
  requireBearer(request, getEnv().cronSecret);
  const deps = getEngineDeps();
  if (!deps) throw new ApiError(503, "not_configured", "The server key is missing.");
  const client = getDentallyClient();
  if (!client) return jsonOk({ skipped: "Dentally is not configured." });
  return jsonOk({ summary: await runDentallyPoll(deps, client) });
});
