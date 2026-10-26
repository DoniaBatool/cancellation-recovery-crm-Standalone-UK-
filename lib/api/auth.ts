import { createHash, timingSafeEqual } from "node:crypto";
import { ApiError } from "@/lib/api/http";

/** Constant-time string comparison (SHA-256 both sides, then timingSafeEqual). */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** Read the token from an "Authorization: Bearer <token>" header. */
export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

/** Throw ApiError(401) unless the request carries the expected bearer token. */
export function requireBearer(request: Request, expected: string | null | undefined): void {
  const token = bearerToken(request);
  if (!expected || !token || !safeEqual(token, expected)) {
    throw new ApiError(401, "unauthorized", "Missing or invalid credentials.");
  }
}
