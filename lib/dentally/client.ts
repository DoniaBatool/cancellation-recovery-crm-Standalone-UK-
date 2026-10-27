// Dentally API client (read-only). Source: SYSTEM_BUILD_GUIDE.md §7 E1.
//
// The clinic gives us a READ-ONLY token, so this client only makes GET requests. `dentallyFetch`
// throws on any other method, so a coding mistake can never try to write to a clinic's diary.
//
// ASSUMED (confirm in the Dentally sandbox before pilot, guide E1 "Confirm in Dentally's API docs"):
//  - paths are under /v1/ (appointments, patients, practitioners, treatments)
//  - lists answer with `{ appointments: [...] }` (or a bare array) and are paged with `page` / `per_page`
//  - the changed-since filter is `updated_at_gteq`; the date range filters are `from` / `to`
// Everything that depends on these guesses lives in this file, so a fix is one place.

export class DentallyError extends Error {
  readonly status: number;
  readonly type: string;
  readonly params: unknown;
  constructor(status: number, type: string, message: string, params?: unknown) {
    super(message);
    this.name = "DentallyError";
    this.status = status;
    this.type = type;
    this.params = params;
  }
}

export type DentallyConfig = {
  baseUrl: string;
  token: string;
  /** Descriptive User-Agent, e.g. "CancellationRecovery/1.0 (you@domain)". */
  userAgent?: string;
  fetchImpl?: typeof fetch;
  /** Replaced in tests so retries do not wait. */
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  maxRetries?: number;
};

export type DentallyAppointment = Record<string, unknown>;

const DEFAULT_UA = "SlotRefill/1.0";
const PAGE_SIZE = 100;
const MAX_PAGES = 20;

export function createDentallyClient(config: DentallyConfig) {
  const fetchImpl = config.fetchImpl ?? fetch;
  const sleep = config.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = config.timeoutMs ?? 10_000;
  const maxRetries = config.maxRetries ?? 3;
  const base = config.baseUrl.replace(/\/+$/, "");

  /** One request with timeout, retry on 429/5xx (exponential backoff, max 3), typed errors. GET only. */
  async function dentallyFetch(path: string, init: RequestInit = {}): Promise<unknown> {
    const method = (init.method ?? "GET").toUpperCase();
    if (method !== "GET") {
      throw new DentallyError(0, "read_only", `Dentally is read-only: ${method} is not allowed.`);
    }
    const url = `${base}${path.startsWith("/") ? "" : "/"}${path}`;

    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await fetchImpl(url, {
          ...init,
          method: "GET",
          headers: {
            ...(init.headers as Record<string, string> | undefined),
            Authorization: `Bearer ${config.token}`,
            "User-Agent": config.userAgent ?? DEFAULT_UA,
            Accept: "application/json",
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if (attempt < maxRetries) {
          await sleep(backoff(attempt));
          continue;
        }
        throw new DentallyError(0, "network", error instanceof Error ? error.message : "Network error");
      }

      if (response.ok) {
        try {
          return await response.json();
        } catch {
          throw new DentallyError(response.status, "invalid_json", "Dentally returned something that is not JSON.");
        }
      }

      if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
        const retryAfter = Number(response.headers.get("retry-after"));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 30_000) : backoff(attempt));
        continue;
      }

      let body: Record<string, unknown> = {};
      try {
        body = (await response.json()) as Record<string, unknown>;
      } catch {
        // not JSON: keep the status only
      }
      // Never include the token or patient data in the message.
      throw new DentallyError(
        response.status,
        typeof body.error === "string" ? body.error : `http_${response.status}`,
        `Dentally answered ${response.status}.`,
        body.params ?? body.errors,
      );
    }
  }

  const backoff = (attempt: number) => 500 * 2 ** attempt;

  /** Pull the list out of `{ appointments: [...] }`, `{ data: [...] }` or a bare array. */
  function unwrapList(data: unknown, key: string): Record<string, unknown>[] {
    if (Array.isArray(data)) return data as Record<string, unknown>[];
    const obj = (data ?? {}) as Record<string, unknown>;
    const list = obj[key] ?? obj.data;
    return Array.isArray(list) ? (list as Record<string, unknown>[]) : [];
  }

  function unwrapOne(data: unknown, key: string): Record<string, unknown> | null {
    const obj = (data ?? {}) as Record<string, unknown>;
    const one = obj[key] ?? obj.data ?? (obj.id ? obj : null);
    return one && typeof one === "object" && !Array.isArray(one) ? (one as Record<string, unknown>) : null;
  }

  async function listAll(path: string, key: string, query: Record<string, string>): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const qs = new URLSearchParams({ ...query, page: String(page), per_page: String(PAGE_SIZE) });
      const rows = unwrapList(await dentallyFetch(`${path}?${qs}`), key);
      out.push(...rows);
      if (rows.length < PAGE_SIZE) break;
    }
    return out;
  }

  return {
    dentallyFetch,
    async getAppointment(id: string): Promise<DentallyAppointment | null> {
      return unwrapOne(await dentallyFetch(`/v1/appointments/${encodeURIComponent(id)}`), "appointment");
    },
    async listAppointments(filter: { updatedSince?: Date; from?: Date; to?: Date } = {}): Promise<DentallyAppointment[]> {
      const query: Record<string, string> = {};
      if (filter.updatedSince) query.updated_at_gteq = filter.updatedSince.toISOString();
      if (filter.from) query.from = filter.from.toISOString();
      if (filter.to) query.to = filter.to.toISOString();
      return listAll("/v1/appointments", "appointments", query);
    },
    async getPatient(id: string): Promise<Record<string, unknown> | null> {
      return unwrapOne(await dentallyFetch(`/v1/patients/${encodeURIComponent(id)}`), "patient");
    },
    async listPractitioners(): Promise<Record<string, unknown>[]> {
      return listAll("/v1/practitioners", "practitioners", {});
    },
    async listTreatments(): Promise<Record<string, unknown>[]> {
      return listAll("/v1/treatments", "treatments", {});
    },
  };
}

export type DentallyClient = ReturnType<typeof createDentallyClient>;
