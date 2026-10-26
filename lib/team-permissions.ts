import type { Role } from "@/lib/constants";

// Team permissions. Source: SYSTEM_BUILD_GUIDE.md §6.8.
//
// | Action                    | Owner (exactly 1)                         | Admin       | Staff |
// | Use the CRM               | yes                                       | yes         | yes   |
// | Invite                    | admin or staff                            | staff only  | no    |
// | Change role admin <-> staff | yes (not the owner)                     | no          | no    |
// | Remove member             | anyone except self/owner                  | staff only  | no    |
// | Transfer ownership        | to an existing member (old owner -> admin)| no          | no    |
//
// Pure functions: the server actions call them before touching the database.

export type Member = { userId: string; role: Role };

/** Roles the actor may give when inviting. */
export function invitableRoles(actor: Role): Role[] {
  if (actor === "owner") return ["admin", "staff"];
  if (actor === "admin") return ["staff"];
  return [];
}

export function canInvite(actor: Role, target: Role): boolean {
  return invitableRoles(actor).includes(target);
}

/** Only the owner changes roles, only between admin and staff, never the owner's own role. */
export function canChangeRole(actor: Role, member: Member, newRole: Role): boolean {
  if (actor !== "owner") return false;
  if (member.role === "owner") return false;
  return newRole === "admin" || newRole === "staff";
}

/** Nobody removes themselves or the owner. The owner removes anyone else; an admin removes staff only. */
export function canRemove(actor: Role, actorId: string, member: Member): boolean {
  if (member.userId === actorId) return false;
  if (member.role === "owner") return false;
  if (actor === "owner") return true;
  if (actor === "admin") return member.role === "staff";
  return false;
}

/** Only the owner hands over ownership, and only to a different, existing member. */
export function canTransferOwnership(actor: Role, actorId: string, member: Member): boolean {
  if (actor !== "owner") return false;
  if (member.userId === actorId) return false;
  return member.role !== "owner";
}

/** Settings (prices, doctors, engine) can be edited by the owner and admins; staff read only. */
export function canEditSettings(role: Role): boolean {
  return role === "owner" || role === "admin";
}

/** Whether the actor can manage the team page at all (see invite / change / remove / transfer). */
export function canManageTeam(role: Role): boolean {
  return role === "owner" || role === "admin";
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  admin: "Admin",
  staff: "Staff",
};
