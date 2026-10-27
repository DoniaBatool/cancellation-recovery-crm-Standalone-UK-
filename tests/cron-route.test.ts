import { beforeEach, describe, expect, it, vi } from "vitest";

const runTick = vi.fn();
const getEngineDeps = vi.fn();

vi.mock("@/lib/env", () => ({ getEnv: () => ({ cronSecret: "c".repeat(32) }) }));
vi.mock("@/lib/engine/runtime", () => ({ getEngineDeps: () => getEngineDeps() }));
vi.mock("@/lib/engine/tick", () => ({ runTick: (d: unknown) => runTick(d) }));

import { GET } from "@/app/api/cron/offers-tick/route";

const call = (token?: string) =>
  GET(new Request("http://localhost/api/cron/offers-tick", { headers: token ? { authorization: `Bearer ${token}` } : {} }));

beforeEach(() => {
  runTick.mockReset().mockResolvedValue({ expiredOffers: 1 });
  getEngineDeps.mockReset().mockReturnValue({ db: {}, notifier: {} });
});

describe("GET /api/cron/offers-tick", () => {
  it("401 without a token or with the wrong one, and never runs the tick", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("wrong")).status).toBe(401);
    expect(runTick).not.toHaveBeenCalled();
  });

  it("runs the tick with the right token", async () => {
    const res = await call("c".repeat(32));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, summary: { expiredOffers: 1 } });
  });

  it("503 when the server key is missing", async () => {
    getEngineDeps.mockReturnValue(null);
    expect((await call("c".repeat(32))).status).toBe(503);
  });
});
