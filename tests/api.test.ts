import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, jsonError, jsonOk, parseJsonBody, withApi } from "@/lib/api/http";
import { bearerToken, requireBearer, safeEqual } from "@/lib/api/auth";

const post = (body: string) => new Request("http://localhost/api/x", { method: "POST", body });

describe("jsonOk / jsonError", () => {
  it("wraps data in { ok: true }", async () => {
    const res = jsonOk({ id: 1 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: 1 });
  });

  it("wraps errors in { ok: false, error } and omits empty details", async () => {
    const res = jsonError(new ApiError(404, "not_found", "No such thing."));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ ok: false, error: { code: "not_found", message: "No such thing." } });
  });

  it("includes details when given", async () => {
    const res = jsonError(new ApiError(422, "validation_error", "Bad.", { name: "Required" }));
    expect((await res.json()).error.details).toEqual({ name: "Required" });
  });
});

describe("parseJsonBody", () => {
  const schema = z.object({ name: z.string().min(1) });

  it("returns parsed data", async () => {
    await expect(parseJsonBody(post('{"name":"Alice"}'), schema)).resolves.toEqual({ name: "Alice" });
  });

  it("throws 400 invalid_json for broken JSON and for an empty body", async () => {
    for (const body of ["{nope", ""]) {
      await expect(parseJsonBody(post(body), schema)).rejects.toMatchObject({ status: 400, code: "invalid_json" });
    }
  });

  it("throws 422 validation_error with field details", async () => {
    await expect(parseJsonBody(post('{"name":""}'), schema)).rejects.toMatchObject({
      status: 422,
      code: "validation_error",
      details: { name: expect.any(String) },
    });
  });
});

describe("withApi", () => {
  const req = new Request("http://localhost/api/x");

  it("passes a normal response through and forwards extra arguments", async () => {
    const handler = withApi(async (_r: Request, id: string) => jsonOk({ id }));
    expect(await (await handler(req, "abc")).json()).toEqual({ ok: true, id: "abc" });
  });

  it("turns ApiError into its JSON response", async () => {
    const res = await withApi(() => {
      throw new ApiError(409, "conflict", "Already done.");
    })(req);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("conflict");
  });

  it("turns a ZodError into 422", async () => {
    const res = await withApi(() => {
      z.object({ a: z.string() }).parse({});
      return jsonOk({});
    })(req);
    expect(res.status).toBe(422);
  });

  it("hides the details of unexpected errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await withApi(() => {
      throw new Error("connection to db failed: password=hunter2");
    })(req);
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).toContain("internal_error");
    expect(text).not.toContain("hunter2");
    spy.mockRestore();
  });
});

describe("bearer auth", () => {
  const withAuth = (value?: string) => new Request("http://localhost/x", { headers: value ? { authorization: value } : {} });

  it("reads the token from the header", () => {
    expect(bearerToken(withAuth("Bearer abc123"))).toBe("abc123");
    expect(bearerToken(withAuth("bearer   abc123  "))).toBe("abc123");
  });

  it("returns null when missing or not a bearer header", () => {
    expect(bearerToken(withAuth())).toBeNull();
    expect(bearerToken(withAuth("Basic abc"))).toBeNull();
    expect(bearerToken(withAuth("Bearer"))).toBeNull();
  });

  it("safeEqual compares exactly", () => {
    expect(safeEqual("secret", "secret")).toBe(true);
    expect(safeEqual("secret", "Secret")).toBe(false);
    expect(safeEqual("secret", "secret ")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });

  it("requireBearer accepts the right token", () => {
    expect(() => requireBearer(withAuth("Bearer right"), "right")).not.toThrow();
  });

  it("requireBearer throws 401 for wrong, missing, or unconfigured secrets", () => {
    for (const [header, expected] of [
      ["Bearer wrong", "right"],
      [undefined, "right"],
      ["Bearer right", undefined],
      ["Bearer right", null],
      ["Bearer ", ""],
    ] as const) {
      expect(() => requireBearer(withAuth(header), expected)).toThrow(ApiError);
      try {
        requireBearer(withAuth(header), expected);
      } catch (err) {
        expect((err as ApiError).status).toBe(401);
      }
    }
  });
});
