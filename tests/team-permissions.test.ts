import { describe, expect, it } from "vitest";
import {
  canChangeRole,
  canEditSettings,
  canInvite,
  canManageTeam,
  canRemove,
  canTransferOwnership,
  invitableRoles,
} from "@/lib/team-permissions";
import type { Role } from "@/lib/constants";

const ME = "me";
const member = (userId: string, role: Role) => ({ userId, role });

describe("invite", () => {
  it("owner invites admin or staff, admin invites staff, staff nobody", () => {
    expect(invitableRoles("owner")).toEqual(["admin", "staff"]);
    expect(invitableRoles("admin")).toEqual(["staff"]);
    expect(invitableRoles("staff")).toEqual([]);
  });

  it("nobody can invite an owner", () => {
    for (const actor of ["owner", "admin", "staff"] as Role[]) expect(canInvite(actor, "owner")).toBe(false);
  });

  it("admin cannot invite an admin", () => {
    expect(canInvite("admin", "admin")).toBe(false);
    expect(canInvite("owner", "admin")).toBe(true);
  });
});

describe("change role", () => {
  it("only the owner, only admin <-> staff", () => {
    expect(canChangeRole("owner", member("a", "staff"), "admin")).toBe(true);
    expect(canChangeRole("owner", member("a", "admin"), "staff")).toBe(true);
    expect(canChangeRole("admin", member("a", "staff"), "admin")).toBe(false);
    expect(canChangeRole("staff", member("a", "staff"), "admin")).toBe(false);
  });

  it("never changes the owner or makes someone owner", () => {
    expect(canChangeRole("owner", member("o", "owner"), "admin")).toBe(false);
    expect(canChangeRole("owner", member("a", "staff"), "owner")).toBe(false);
  });
});

describe("remove", () => {
  it("nobody removes themselves or the owner", () => {
    expect(canRemove("owner", ME, member(ME, "owner"))).toBe(false);
    expect(canRemove("admin", ME, member(ME, "admin"))).toBe(false);
    expect(canRemove("admin", ME, member("o", "owner"))).toBe(false);
  });

  it("owner removes admin and staff", () => {
    expect(canRemove("owner", ME, member("a", "admin"))).toBe(true);
    expect(canRemove("owner", ME, member("s", "staff"))).toBe(true);
  });

  it("admin removes staff only; staff removes nobody", () => {
    expect(canRemove("admin", ME, member("s", "staff"))).toBe(true);
    expect(canRemove("admin", ME, member("a", "admin"))).toBe(false);
    expect(canRemove("staff", ME, member("s", "staff"))).toBe(false);
  });
});

describe("transfer ownership", () => {
  it("owner to a different non-owner member only", () => {
    expect(canTransferOwnership("owner", ME, member("a", "admin"))).toBe(true);
    expect(canTransferOwnership("owner", ME, member("s", "staff"))).toBe(true);
    expect(canTransferOwnership("owner", ME, member(ME, "owner"))).toBe(false);
    expect(canTransferOwnership("admin", ME, member("s", "staff"))).toBe(false);
  });
});

describe("settings and team page", () => {
  it("owner and admin edit settings, staff read only", () => {
    expect(canEditSettings("owner")).toBe(true);
    expect(canEditSettings("admin")).toBe(true);
    expect(canEditSettings("staff")).toBe(false);
    expect(canManageTeam("staff")).toBe(false);
    expect(canManageTeam("admin")).toBe(true);
  });
});
