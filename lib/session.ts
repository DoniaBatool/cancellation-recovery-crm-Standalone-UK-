import { cache } from "react";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isRole, type Role } from "@/lib/constants";

export type AuthUser = { id: string; email: string | null };

export type SessionContext = {
  user: AuthUser;
  role: Role;
  clinic: { id: string; name: string; slug: string; timezone: string };
};

/** The signed-in user from the (verified) JWT claims, or null. */
export const getAuthUser = cache(async (): Promise<AuthUser | null> => {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (error || !claims?.sub) return null;
  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : null };
});

/** The signed-in user plus their clinic and team role, or null if not linked. */
export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  const user = await getAuthUser();
  if (!user) return null;

  const supabase = await createSupabaseServerClient();

  // RLS limits both queries to this user's own rows.
  const { data: membership } = await supabase
    .from("clinic_users")
    .select("clinic_id, role")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (!membership || !isRole(membership.role)) return null;
  const role = membership.role;

  const { data: clinic } = await supabase
    .from("clinics")
    .select("id, name, slug, timezone")
    .eq("id", membership.clinic_id)
    .maybeSingle();
  if (!clinic) return null;

  return { user, role, clinic };
});

export async function requireAuthUser(): Promise<AuthUser> {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  return user;
}

/** For CRM pages: redirects to /login or /no-access when needed. */
export async function requireSession(): Promise<SessionContext> {
  const user = await getAuthUser();
  if (!user) redirect("/login");
  const ctx = await getSessionContext();
  if (!ctx) redirect("/no-access");
  return ctx;
}
