import { getSessionContext, type SessionContext } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { FormState } from "@/lib/form-state";
import type { Role } from "@/lib/constants";

// Shared start of every staff server action: who is calling, which clinic, which role.
// Server actions are public HTTP endpoints, so each one re-checks the session itself
// (guide §15) instead of trusting that the page was only shown to the right people.

export type StaffContext = SessionContext & {
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  /** Written to added_by / history so the audit trail names a person. */
  actorLabel: string;
};

export const SIGN_IN_AGAIN: FormState = { error: "Your session has ended. Please sign in again." };
export const NOT_ALLOWED: FormState = { error: "You don't have permission to do that." };

export async function getStaffContext(allowed?: readonly Role[]): Promise<StaffContext | null> {
  const ctx = await getSessionContext();
  if (!ctx) return null;
  if (allowed && !allowed.includes(ctx.role)) return null;
  const supabase = await createSupabaseServerClient();
  return { ...ctx, supabase, actorLabel: ctx.user.email ?? "staff" };
}
