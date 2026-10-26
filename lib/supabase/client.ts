import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";

/** Browser client (publishable key only). Used for Realtime or client-side reads. */
export function createSupabaseBrowserClient() {
  // Read literally so Next can inline NEXT_PUBLIC_* values into the bundle.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. Copy .env.example to .env.local.",
    );
  }
  return createBrowserClient<Database>(url, key);
}
