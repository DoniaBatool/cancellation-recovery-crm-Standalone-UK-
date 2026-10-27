import { createHash } from "node:crypto";

// Small fixed-window rate limiter. Source: SYSTEM_BUILD_GUIDE.md §15 ("a small table").
// The counter lives in Postgres (public.rate_limits + rate_limit_hit(), migration 0004), so it works
// across serverless instances. It FAILS OPEN: if the database hiccups, a real patient is never blocked.
// Identifiers (IP addresses, phone numbers) are hashed before they are stored.

export type RateLimitRule = { name: string; limit: number; windowSeconds: number };

export const RATE_LIMITS = {
  /** Public waitlist sign-up. Generous: a waiting room may share one wifi address. */
  join: { name: "join", limit: 20, windowSeconds: 3600 },
  /** Opening the patient offer page. */
  confirmView: { name: "confirm-view", limit: 120, windowSeconds: 600 },
  /** Answering an offer from the page. */
  confirmAnswer: { name: "confirm-answer", limit: 30, windowSeconds: 600 },
  /** Texts from one phone number (stops auto-reply loops). */
  smsInbound: { name: "sms-inbound", limit: 30, windowSeconds: 3600 },
} as const satisfies Record<string, RateLimitRule>;

type RpcResult = PromiseLike<{ data: boolean | null; error: unknown }>;
export type RateLimitDb = {
  rpc: (fn: "rate_limit_hit", args: { p_key: string; p_window_seconds: number; p_limit: number }) => RpcResult;
};

/** Best guess at the caller's address from proxy headers (Vercel sets x-forwarded-for). */
export function clientIp(headers: { get(name: string): string | null }): string {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || headers.get("x-real-ip")?.trim() || "unknown";
}

export function rateLimitKey(rule: RateLimitRule, identifier: string): string {
  const hash = createHash("sha256").update(identifier).digest("hex").slice(0, 32);
  return `${rule.name}:${hash}`;
}

/** true = allowed, false = over the limit. Never throws. */
export async function checkRateLimit(db: RateLimitDb, rule: RateLimitRule, identifier: string): Promise<boolean> {
  try {
    const { data, error } = await db.rpc("rate_limit_hit", {
      p_key: rateLimitKey(rule, identifier),
      p_window_seconds: rule.windowSeconds,
      p_limit: rule.limit,
    });
    if (error || typeof data !== "boolean") return true;
    return data;
  } catch {
    return true;
  }
}
