"use server";

import { revalidatePath } from "next/cache";
import { isRole, type Role } from "@/lib/constants";
import { getAppUrl } from "@/lib/env";
import type { FormState } from "@/lib/form-state";
import { getStaffContext, NOT_ALLOWED, SIGN_IN_AGAIN, type StaffContext } from "@/lib/staff-session";
import { getAdminClient } from "@/lib/supabase/admin";
import { canChangeRole, canInvite, canRemove, canTransferOwnership, type Member } from "@/lib/team-permissions";
import { fieldErrors, formDataToObject, inviteSchema, memberRoleSchema, memberTargetSchema } from "@/lib/validation";

// Team actions. Source: SYSTEM_BUILD_GUIDE.md §6.8 and §8.3.
// Reading other members and inviting need the admin client. Every action checks the session
// and the permission rule FIRST, and every query is scoped to the session's clinic id.

const GENERIC = "Something went wrong. Please try again.";

type Admin = ReturnType<typeof getAdminClient>;

async function start(): Promise<{ ctx: StaffContext; admin: Admin } | { fail: FormState }> {
  const ctx = await getStaffContext(["owner", "admin"]);
  if (!ctx) return { fail: (await getStaffContext()) ? NOT_ALLOWED : SIGN_IN_AGAIN };
  try {
    return { ctx, admin: getAdminClient() };
  } catch {
    return { fail: { error: "Team changes need the server key (SUPABASE_SECRET_KEY) to be set." } };
  }
}

async function findMember(admin: Admin, clinicId: string, userId: string): Promise<Member | null> {
  const { data } = await admin
    .from("clinic_users")
    .select("user_id, role")
    .eq("clinic_id", clinicId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data || !isRole(data.role)) return null;
  return { userId: data.user_id, role: data.role };
}

export async function inviteMember(_prev: FormState, formData: FormData): Promise<FormState> {
  const s = await start();
  if ("fail" in s) return s.fail;
  const { ctx, admin } = s;

  const parsed = inviteSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error) };
  const { email, role } = parsed.data;
  if (!canInvite(ctx.role, role)) return NOT_ALLOWED;

  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${getAppUrl()}/auth/confirm?next=/set-password`,
  });
  if (error || !data.user) {
    // Log only the code and status (never the email) so a failed invite can be debugged from the server log.
    console.error("inviteMember failed", { code: error?.code, status: error?.status });
    const exists = /already|registered|exists/i.test(error?.message ?? "");
    return {
      error: exists
        ? "That email already has an account, so it can't be invited here. Ask the person to use a different email."
        : "Could not send the invitation. Please check the email address and try again.",
    };
  }

  const { error: linkError } = await admin
    .from("clinic_users")
    .insert({ clinic_id: ctx.clinic.id, user_id: data.user.id, role });
  if (linkError) return { error: GENERIC };

  revalidatePath("/crm/team");
  return { message: `Invitation sent to ${email}.` };
}

export async function changeMemberRole(_prev: FormState, formData: FormData): Promise<FormState> {
  const s = await start();
  if ("fail" in s) return s.fail;
  const { ctx, admin } = s;

  const parsed = memberRoleSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { error: GENERIC };

  const member = await findMember(admin, ctx.clinic.id, parsed.data.user_id);
  if (!member) return { error: "That person is no longer on the team." };
  if (!canChangeRole(ctx.role, member, parsed.data.role)) return NOT_ALLOWED;

  const { error } = await admin
    .from("clinic_users")
    .update({ role: parsed.data.role })
    .eq("clinic_id", ctx.clinic.id)
    .eq("user_id", member.userId);
  if (error) return { error: GENERIC };

  revalidatePath("/crm/team");
  return { message: "Role updated." };
}

export async function removeMember(_prev: FormState, formData: FormData): Promise<FormState> {
  const s = await start();
  if ("fail" in s) return s.fail;
  const { ctx, admin } = s;

  const parsed = memberTargetSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { error: GENERIC };

  const member = await findMember(admin, ctx.clinic.id, parsed.data.user_id);
  if (!member) return { error: "That person is no longer on the team." };
  if (!canRemove(ctx.role, ctx.user.id, member)) return NOT_ALLOWED;

  const { error } = await admin
    .from("clinic_users")
    .delete()
    .eq("clinic_id", ctx.clinic.id)
    .eq("user_id", member.userId);
  if (error) return { error: GENERIC };

  revalidatePath("/crm/team");
  return { message: "Member removed." };
}

/** Owner hands ownership to an existing member; the old owner becomes admin. */
export async function transferOwnership(_prev: FormState, formData: FormData): Promise<FormState> {
  const s = await start();
  if ("fail" in s) return s.fail;
  const { ctx, admin } = s;

  const parsed = memberTargetSchema.safeParse(formDataToObject(formData));
  if (!parsed.success) return { error: GENERIC };

  const member = await findMember(admin, ctx.clinic.id, parsed.data.user_id);
  if (!member) return { error: "That person is no longer on the team." };
  if (!canTransferOwnership(ctx.role, ctx.user.id, member)) return NOT_ALLOWED;

  // A unique index allows only one owner, so demote first, then promote; undo if the second step fails.
  const setRole = (userId: string, role: Role) =>
    admin.from("clinic_users").update({ role }).eq("clinic_id", ctx.clinic.id).eq("user_id", userId);

  const demote = await setRole(ctx.user.id, "admin");
  if (demote.error) return { error: GENERIC };
  const promote = await setRole(member.userId, "owner");
  if (promote.error) {
    await setRole(ctx.user.id, "owner");
    return { error: GENERIC };
  }

  revalidatePath("/crm/team");
  return { message: "Ownership transferred. You are now an admin." };
}
