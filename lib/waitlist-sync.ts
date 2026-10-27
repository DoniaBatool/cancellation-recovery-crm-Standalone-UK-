// Dentally short-notice list -> our waitlist. Source: SYSTEM_BUILD_GUIDE.md §6.7 (optional E5).
// Pure planning only: the caller does the lookups (byPms, byContact) and applies the result.
// If an insert fails with a unique violation (23505), retry once as an update: two syncs can race.

export type SyncInput = {
  pms_patient_id: string | null;
  patient_name: string | null;
  phone: string | null;
  email: string | null;
  is_active: boolean;
};

export type SyncTarget = { id: string; is_active: boolean; pms_patient_id: string | null };

export type SyncPlan =
  | { action: "ignored" }
  | { action: "created" }
  | { action: "deactivated"; id: string }
  | { action: "updated"; id: string }
  | { action: "linked"; id: string }
  | { action: "invalid"; reason: string };

export function planWaitlistSync(input: SyncInput, byPms: SyncTarget | null, byContact: SyncTarget | null): SyncPlan {
  const target = byPms ?? byContact;
  if (!target) {
    if (!input.is_active) return { action: "ignored" };
    if (!input.patient_name?.trim() || (!input.phone && !input.email)) {
      return { action: "invalid", reason: "A name and a phone number or email are needed." };
    }
    return { action: "created" };
  }
  if (!input.is_active) return { action: "deactivated", id: target.id };
  return byPms ? { action: "updated", id: target.id } : { action: "linked", id: target.id };
}
