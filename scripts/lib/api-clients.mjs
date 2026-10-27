// Small HTTP clients used by the clinic scripts. `fetchImpl` is injectable so tests never touch the network.
// Error messages never include tokens.

export class ApiCallError extends Error {
  constructor(service, method, path, status, detail) {
    super(`${service} ${method} ${path} failed (${status})${detail ? `: ${detail}` : ""}`);
    this.name = "ApiCallError";
    this.status = status;
  }
}

async function call({ service, base, token, fetchImpl, method, path, body }) {
  const res = await fetchImpl(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const detail = (json && (json.message || json.error?.message || json.error)) || text.slice(0, 200);
    throw new ApiCallError(service, method, path.split("?")[0], res.status, typeof detail === "string" ? detail : JSON.stringify(detail));
  }
  return json;
}

/** Choose the publishable and secret keys from the Management API list (new-style keys first, legacy as fallback). */
export function pickKeys(list) {
  const items = Array.isArray(list) ? list : [];
  const publishable = items.find((k) => k.type === "publishable") ?? items.find((k) => k.name === "anon");
  const secret = items.find((k) => k.type === "secret") ?? items.find((k) => k.name === "service_role");
  if (!publishable?.api_key || !secret?.api_key) {
    throw new Error("Could not find the publishable and secret API keys for this Supabase project.");
  }
  return { publishableKey: publishable.api_key, secretKey: secret.api_key };
}

export function createSupabaseMgmt({ token, fetchImpl = fetch, base = "https://api.supabase.com" }) {
  const req = (method, path, body) => call({ service: "Supabase", base, token, fetchImpl, method, path, body });
  return {
    async getApiKeys(ref) {
      return pickKeys(await req("GET", `/v1/projects/${ref}/api-keys?reveal=true`));
    },
    /** Runs SQL as the database owner. Returns the rows of the last statement. */
    async query(ref, sql) {
      return (await req("POST", `/v1/projects/${ref}/database/query`, { query: sql })) ?? [];
    },
    async patchAuthConfig(ref, payload) {
      return req("PATCH", `/v1/projects/${ref}/config/auth`, payload);
    },
  };
}

export function createVercel({ token, teamId, fetchImpl = fetch, base = "https://api.vercel.com" }) {
  return {
    /** Create or update variables (upsert). Throws if Vercel reports any failed variable. */
    async pushEnv(projectId, vars) {
      const query = `?upsert=true${teamId ? `&teamId=${encodeURIComponent(teamId)}` : ""}`;
      const body = vars.map((v) => ({ key: v.key, value: v.value, type: v.type, target: ["production", "preview"] }));
      const result = await call({
        service: "Vercel",
        base,
        token,
        fetchImpl,
        method: "POST",
        path: `/v10/projects/${encodeURIComponent(projectId)}/env${query}`,
        body,
      });
      const failed = result?.failed ?? [];
      if (failed.length > 0) {
        const names = failed.map((f) => f.error?.key ?? f.error?.envVarKey ?? "?").join(", ");
        throw new Error(`Vercel could not save: ${names}`);
      }
      return body.length;
    },
  };
}
