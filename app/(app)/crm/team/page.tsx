import type { Metadata } from "next";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/shell/page-header";
import { isRole } from "@/lib/constants";
import { requireSession } from "@/lib/session";
import { getAdminClient } from "@/lib/supabase/admin";
import { TeamView, type TeamMember } from "./team-view";

export const metadata: Metadata = { title: "Team" };

const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/London" });

export default async function TeamPage() {
  const { clinic, user, role } = await requireSession();

  // clinic_users only shows your own row to the session client, so the member list is read
  // with the admin client, after requireSession(), scoped to this clinic.
  let members: TeamMember[] = [];
  try {
    const admin = getAdminClient();
    const { data: rows, error } = await admin
      .from("clinic_users")
      .select("user_id, role, created_at")
      .eq("clinic_id", clinic.id)
      .order("created_at", { ascending: true });
    if (error) throw error;

    members = await Promise.all(
      (rows ?? [])
        .filter((r) => isRole(r.role))
        .map(async (r) => {
          const { data } = await admin.auth.admin.getUserById(r.user_id);
          return {
            userId: r.user_id,
            email: data.user?.email ?? "(unknown)",
            role: r.role as TeamMember["role"],
            joined: dateFormat.format(new Date(r.created_at)),
            isYou: r.user_id === user.id,
          };
        }),
    );
  } catch {
    return (
      <>
        <PageHeader title="Team" />
        <Alert tone="error">The team list could not be loaded. The server key (SUPABASE_SECRET_KEY) may be missing.</Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Team" description={`People who can sign in to ${clinic.name}.`} />
      <TeamView members={members} actor={role} actorId={user.id} />
    </>
  );
}
