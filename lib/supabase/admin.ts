import { createClient } from "@supabase/supabase-js";
import { getEnv } from "@/lib/env";
import type { Database } from "@/lib/database.types";

/**
 * Secret-key client. It BYPASSES Row Level Security.
 *
 * Use it ONLY for: patient pages (/confirm, /join), webhooks, crons and team
 * invites (guide §3.3 rule 3). Always check the session and role first when
 * acting for a staff member. It must never reach the browser.
 */
export function getAdminClient() {
  if (typeof window !== "undefined") {
    throw new Error("getAdminClient() must never run in the browser.");
  }
  const { supabase } = getEnv();
  return createClient<Database>(supabase.url, supabase.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
