import { requireBearer } from "@/lib/api/auth";
import { ApiError, jsonOk, withApi } from "@/lib/api/http";
import { getEnv } from "@/lib/env";
import { getEngineDeps } from "@/lib/engine/runtime";
import { runTick } from "@/lib/engine/tick";

// Once a minute (pg_cron + pg_net, or Vercel Cron). Auth: Authorization: Bearer CRON_SECRET.
export const dynamic = "force-dynamic";

export const GET = withApi(async (request) => {
  requireBearer(request, getEnv().cronSecret);
  const deps = getEngineDeps();
  if (!deps) throw new ApiError(503, "not_configured", "The server key is missing.");
  const summary = await runTick(deps);
  return jsonOk({ summary });
});
