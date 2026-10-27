import type { Doctor } from "@/lib/validation";

// Import dentists from Dentally into Settings. Source: SYSTEM_BUILD_GUIDE.md §7 E1 (listPractitioners).
// Only NEW practitioners are added (matched by id), so names and emails reception typed are never overwritten.

export function practitionersToDoctors(rows: readonly Record<string, unknown>[]): Doctor[] {
  const out: Doctor[] = [];
  for (const p of rows) {
    if (p.id == null) continue;
    const id = String(p.id);
    const name =
      [p.first_name, p.last_name].filter((x): x is string => typeof x === "string" && x.trim() !== "").join(" ").trim() ||
      (typeof p.name === "string" ? p.name.trim() : "");
    if (!name) continue;
    const email = typeof p.email_address === "string" && p.email_address ? p.email_address : typeof p.email === "string" && p.email ? p.email : undefined;
    out.push(email ? { id, name, email } : { id, name });
  }
  return out;
}

export function mergeDoctors(existing: readonly Doctor[], imported: readonly Doctor[]): { doctors: Doctor[]; added: number } {
  const known = new Set(existing.map((d) => d.id));
  const fresh = imported.filter((d, i) => !known.has(d.id) && imported.findIndex((x) => x.id === d.id) === i);
  return { doctors: [...existing, ...fresh], added: fresh.length };
}
