import type { Doctor } from "@/lib/validation";

/** Read clinic_config.doctors (JSON) safely: anything malformed is skipped. */
export function readDoctors(value: unknown): Doctor[] {
  if (!Array.isArray(value)) return [];
  const out: Doctor[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const { id, name, email } = item as Record<string, unknown>;
    if (typeof id !== "string" || !id || typeof name !== "string" || !name) continue;
    out.push(typeof email === "string" && email ? { id, name, email } : { id, name });
  }
  return out;
}

/** Display name for a doctor id; falls back to the id for a dentist removed from Settings. */
export function doctorName(doctors: Doctor[], id: string | null | undefined): string {
  if (!id) return "Any dentist";
  return doctors.find((d) => d.id === id)?.name ?? id;
}
