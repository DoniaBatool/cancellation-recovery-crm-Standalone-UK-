import { requireBearer } from "@/lib/api/auth";
import { ApiError, jsonOk, withApi } from "@/lib/api/http";
import { getEnv } from "@/lib/env";
import { collectHealth } from "@/lib/engine/health";
import { getEngineDeps } from "@/lib/engine/runtime";

// Health snapshot (no patient data). Auth: Bearer CRON_SECRET. Source: guide §7 E10.
export const dynamic = "force-dynamic";

export const GET = withApi(async (request) => {
  const env = getEnv();
  requireBearer(request, env.cronSecret);
  const deps = getEngineDeps();
  if (!deps) throw new ApiError(503, "not_configured", "The server key is missing.");
  const health = await collectHealth(deps, env.dentally !== null);
  return jsonOk({ health: { ...health, clinicId: undefined } }, { status: health.dbOk ? 200 : 503 });
});
