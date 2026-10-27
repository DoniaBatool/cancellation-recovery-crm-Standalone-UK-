import { requireBearer } from "@/lib/api/auth";
import { ApiError, jsonOk, withApi } from "@/lib/api/http";
import { getMailer } from "@/lib/email";
import { getEnv } from "@/lib/env";
import { runHealthCheck } from "@/lib/engine/health";
import { getEngineDeps } from "@/lib/engine/runtime";

// Hourly. Emails OPERATOR_ALERT_EMAIL when something is wrong. Auth: Bearer CRON_SECRET.
export const dynamic = "force-dynamic";

export const GET = withApi(async (request) => {
  const env = getEnv();
  requireBearer(request, env.cronSecret);
  const deps = getEngineDeps();
  if (!deps) throw new ApiError(503, "not_configured", "The server key is missing.");
  const result = await runHealthCheck(deps, {
    dentally: env.dentally !== null,
    mailer: getMailer(env.email),
    operatorEmail: env.operatorAlertEmail,
    appUrl: env.appUrl,
  });
  return jsonOk({ alerts: result.alerts.map((a) => a.kind), emailed: result.emailed.map((a) => a.kind) });
});
