import { z } from "zod";
import { fieldErrors } from "@/lib/validation";

// API conventions. Source: SYSTEM_BUILD_GUIDE.md §3.3 rule 4:
//   { ok: true, ...data }  or  { ok: false, error: { code, message, details? } }
// Throw `new ApiError(status, code, message)` and let withApi() turn it into JSON.

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function jsonOk<T extends Record<string, unknown>>(data: T, init?: ResponseInit): Response {
  return Response.json({ ok: true, ...data }, init);
}

export function jsonError(error: ApiError): Response {
  const body: { ok: false; error: { code: string; message: string; details?: unknown } } = {
    ok: false,
    error: { code: error.code, message: error.message },
  };
  if (error.details !== undefined) body.error.details = error.details;
  return Response.json(body, { status: error.status });
}

/** Parse and validate a JSON request body. Throws ApiError(400/422). */
export async function parseJsonBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ApiError(400, "invalid_json", "Request body must be valid JSON.");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(422, "validation_error", "Request body failed validation.", fieldErrors(parsed.error));
  }
  return parsed.data;
}

type Handler<A extends unknown[]> = (request: Request, ...rest: A) => Promise<Response> | Response;

/** Wrap a route handler so thrown ApiErrors and unexpected errors become JSON. */
export function withApi<A extends unknown[]>(handler: Handler<A>): Handler<A> {
  return async (request, ...rest) => {
    try {
      return await handler(request, ...rest);
    } catch (err) {
      if (err instanceof ApiError) return jsonError(err);
      if (err instanceof z.ZodError) {
        return jsonError(new ApiError(422, "validation_error", "Validation failed.", fieldErrors(err)));
      }
      // Never leak internals or patient data; log the error name/message only.
      console.error("Unhandled API error:", err instanceof Error ? err.message : "unknown");
      return jsonError(new ApiError(500, "internal_error", "Something went wrong."));
    }
  };
}
