import { headers } from "next/headers";
import { getAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, clientIp, type RateLimitRule } from "@/lib/rate-limit";

/** true = this caller (by IP) is over the limit. Fails open when the database or env is not available. */
export async function isIpRateLimited(rule: RateLimitRule): Promise<boolean> {
  try {
    const ip = clientIp(await headers());
    return !(await checkRateLimit(getAdminClient(), rule, ip));
  } catch {
    return false;
  }
}
