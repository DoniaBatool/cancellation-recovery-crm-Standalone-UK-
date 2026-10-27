import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

let claims: { sub: string } | null = null;

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { getClaims: async () => ({ data: claims ? { claims } : null, error: null }) },
  }),
}));

import { config, proxy } from "@/proxy";

const req = (pathAndQuery: string) => new NextRequest(`http://localhost:3000${pathAndQuery}`);
const location = (res: Response) => res.headers.get("location");

beforeEach(() => {
  claims = null;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "pk");
});

describe("proxy: logged out", () => {
  it.each(["/dashboard", "/crm", "/crm/waitlist", "/crm/patient/123", "/approve/abc"])("sends %s to /login with ?next", async (p) => {
    const res = await proxy(req(p));
    expect(res.status).toBe(307);
    expect(new URL(location(res)!).pathname).toBe("/login");
    expect(new URL(location(res)!).searchParams.get("next")).toBe(p);
  });

  it("keeps the query string in next", async () => {
    const res = await proxy(req("/dashboard?range=month"));
    expect(new URL(location(res)!).searchParams.get("next")).toBe("/dashboard?range=month");
  });

  it.each(["/login", "/forgot-password", "/set-password", "/no-access", "/"])("lets %s through", async (p) => {
    const res = await proxy(req(p));
    expect(location(res)).toBeNull();
  });

  it("does not guard look-alike paths such as /crmx", async () => {
    expect(location(await proxy(req("/crmx")))).toBeNull();
  });
});

describe("proxy: logged in", () => {
  beforeEach(() => {
    claims = { sub: "user-1" };
  });

  it("lets protected pages through", async () => {
    expect(location(await proxy(req("/dashboard")))).toBeNull();
    expect(location(await proxy(req("/crm/team")))).toBeNull();
  });

  it("moves /login on to /dashboard by default", async () => {
    const res = await proxy(req("/login"));
    expect(new URL(location(res)!).pathname).toBe("/dashboard");
  });

  it("moves /login on to a safe ?next", async () => {
    const res = await proxy(req("/login?next=/crm/waitlist"));
    expect(new URL(location(res)!).pathname).toBe("/crm/waitlist");
  });

  it("ignores an unsafe ?next", async () => {
    for (const bad of ["//evil.example", "https://evil.example", "/%5Cevil"]) {
      const res = await proxy(req(`/login?next=${encodeURIComponent(bad)}`));
      const target = new URL(location(res)!);
      expect(target.host).toBe("localhost:3000");
    }
    const res = await proxy(req(`/login?next=${encodeURIComponent("//evil.example")}`));
    expect(new URL(location(res)!).pathname).toBe("/dashboard");
  });
});

describe("proxy matcher (guide §9)", () => {
  const re = new RegExp(`^${config.matcher[0]}$`);

  it.each(["/", "/dashboard", "/crm", "/login", "/auth/confirm", "/set-password"])("runs on %s", (p) => {
    expect(re.test(p)).toBe(true);
  });

  it.each([
    "/c/abc",
    "/api/health",
    "/api/webhooks/twilio/inbound",
    "/confirm/abc",
    "/join/smile-dental",
    "/_next/static/chunk.js",
    "/_next/image",
    "/favicon.ico",
    "/logo.svg",
    "/photo.png",
  ])("skips %s", (p) => {
    expect(re.test(p)).toBe(false);
  });
});
