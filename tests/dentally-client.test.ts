import { describe, expect, it, vi } from "vitest";
import { createDentallyClient, DentallyError } from "@/lib/dentally/client";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function client(fetchImpl: ReturnType<typeof vi.fn>, extra = {}) {
  return createDentallyClient({ baseUrl: "https://api.sandbox.dentally.co/", token: "tok-secret", userAgent: "Test/1.0", fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async () => {}, ...extra });
}

describe("dentallyFetch", () => {
  it("sends the bearer token, user agent, and only GET", async () => {
    const f = vi.fn().mockResolvedValue(json({ appointments: [] }));
    await client(f).dentallyFetch("/v1/appointments");
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("https://api.sandbox.dentally.co/v1/appointments");
    expect(init.method).toBe("GET");
    expect(init.headers).toMatchObject({ Authorization: "Bearer tok-secret", "User-Agent": "Test/1.0", Accept: "application/json" });
  });

  it.each(["POST", "PUT", "PATCH", "DELETE", "post"])("rejects %s without making a request", async (method) => {
    const f = vi.fn();
    await expect(client(f).dentallyFetch("/v1/appointments", { method })).rejects.toMatchObject({ type: "read_only" });
    expect(f).not.toHaveBeenCalled();
  });

  it("401 -> typed error without the token or body in the message", async () => {
    const f = vi.fn().mockResolvedValue(json({ error: "unauthorised" }, 401));
    const err = (await client(f).dentallyFetch("/v1/x").catch((e: unknown) => e)) as DentallyError;
    expect(err).toBeInstanceOf(DentallyError);
    expect(err).toMatchObject({ status: 401, type: "unauthorised" });
    expect(err.message).not.toContain("tok-secret");
    expect(f).toHaveBeenCalledTimes(1); // no retry for 4xx
  });

  it("422 carries the params", async () => {
    const f = vi.fn().mockResolvedValue(json({ error: "invalid", params: { from: ["bad date"] } }, 422));
    const err = (await client(f).dentallyFetch("/v1/x").catch((e: unknown) => e)) as DentallyError;
    expect(err).toMatchObject({ status: 422, type: "invalid", params: { from: ["bad date"] } });
  });

  it("429 -> waits -> retries -> 200", async () => {
    const f = vi.fn().mockResolvedValueOnce(json({}, 429, { "retry-after": "1" })).mockResolvedValueOnce(json({ ok: 1 }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    expect(await client(f, { sleep }).dentallyFetch("/v1/x")).toEqual({ ok: 1 });
    expect(f).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it("5xx retries up to 3 times then gives up", async () => {
    const f = vi.fn().mockImplementation(async () => json({}, 503));
    await expect(client(f).dentallyFetch("/v1/x")).rejects.toMatchObject({ status: 503 });
    expect(f).toHaveBeenCalledTimes(4); // first try + 3 retries
  });

  it("a network error retries and then reports 'network'", async () => {
    const f = vi.fn().mockRejectedValue(new Error("socket hang up"));
    await expect(client(f).dentallyFetch("/v1/x")).rejects.toMatchObject({ type: "network" });
    expect(f).toHaveBeenCalledTimes(4);
  });
});

describe("list and get helpers", () => {
  it("getAppointment reads the record and encodes the id", async () => {
    const f = vi.fn().mockResolvedValue(json({ appointment: { id: 7, state: "cancelled" } }));
    expect(await client(f).getAppointment("a/b")).toEqual({ id: 7, state: "cancelled" });
    expect(f.mock.calls[0]![0]).toContain("/v1/appointments/a%2Fb");
  });

  it("listAppointments sends the filters and follows pages until a short page", async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ id: i }));
    const f = vi.fn().mockResolvedValueOnce(json({ appointments: full })).mockResolvedValueOnce(json({ appointments: [{ id: 100 }] }));
    const rows = await client(f).listAppointments({ updatedSince: new Date("2026-10-26T09:00:00Z") });
    expect(rows).toHaveLength(101);
    expect(f.mock.calls[0]![0]).toContain("updated_at_gteq=2026-10-26T09%3A00%3A00.000Z");
    expect(f.mock.calls[1]![0]).toContain("page=2");
  });

  it("accepts a bare array and an empty answer", async () => {
    expect(await client(vi.fn().mockResolvedValue(json([{ id: 1 }]))).listPractitioners()).toEqual([{ id: 1 }]);
    expect(await client(vi.fn().mockResolvedValue(json({}))).listAppointments()).toEqual([]);
  });

  it("returns null for a missing record", async () => {
    expect(await client(vi.fn().mockResolvedValue(json({}))).getPatient("1")).toBeNull();
  });
});
