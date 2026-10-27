import { describe, expect, it } from "vitest";
import { checkRateLimit, clientIp, rateLimitKey, RATE_LIMITS, type RateLimitDb } from "@/lib/rate-limit";

/** In-memory stand-in for rate_limit_hit(): counts per key, allows up to the limit. */
function fakeDb(): RateLimitDb & { calls: Array<{ p_key: string; p_window_seconds: number; p_limit: number }> } {
  const counts = new Map<string, number>();
  const calls: Array<{ p_key: string; p_window_seconds: number; p_limit: number }> = [];
  return {
    calls,
    rpc: async (_fn, args) => {
      calls.push(args);
      const n = (counts.get(args.p_key) ?? 0) + 1;
      counts.set(args.p_key, n);
      return { data: n <= args.p_limit, error: null };
    },
  };
}

describe("rate limit", () => {
  const rule = { name: "t", limit: 2, windowSeconds: 60 };

  it("allows up to the limit, then blocks", async () => {
    const db = fakeDb();
    expect(await checkRateLimit(db, rule, "1.2.3.4")).toBe(true);
    expect(await checkRateLimit(db, rule, "1.2.3.4")).toBe(true);
    expect(await checkRateLimit(db, rule, "1.2.3.4")).toBe(false);
  });

  it("counts each caller separately", async () => {
    const db = fakeDb();
    await checkRateLimit(db, rule, "a");
    await checkRateLimit(db, rule, "a");
    expect(await checkRateLimit(db, rule, "b")).toBe(true);
  });

  it("never stores the raw identifier", async () => {
    const db = fakeDb();
    await checkRateLimit(db, rule, "+447700900123");
    expect(db.calls[0]?.p_key).not.toContain("447700900123");
    expect(db.calls[0]?.p_key).toBe(rateLimitKey(rule, "+447700900123"));
    expect(db.calls[0]?.p_key.startsWith("t:")).toBe(true);
  });

  it("fails open when the database errors or throws", async () => {
    const erroring: RateLimitDb = { rpc: async () => ({ data: null, error: { message: "boom" } }) };
    const throwing: RateLimitDb = {
      rpc: () => {
        throw new Error("down");
      },
    };
    expect(await checkRateLimit(erroring, rule, "x")).toBe(true);
    expect(await checkRateLimit(throwing, rule, "x")).toBe(true);
  });

  it("reads the client address from proxy headers", () => {
    const h = (m: Record<string, string>) => ({ get: (n: string) => m[n] ?? null });
    expect(clientIp(h({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }))).toBe("9.9.9.9");
    expect(clientIp(h({ "x-real-ip": "8.8.8.8" }))).toBe("8.8.8.8");
    expect(clientIp(h({}))).toBe("unknown");
  });

  it("has sensible rules for the public entry points", () => {
    expect(RATE_LIMITS.join.limit).toBeGreaterThanOrEqual(10);
    expect(RATE_LIMITS.smsInbound.windowSeconds).toBe(3600);
  });
});
