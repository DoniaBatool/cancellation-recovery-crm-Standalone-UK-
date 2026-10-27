import type { Json } from "@/lib/database.types";
import type { Db } from "@/lib/pipeline";

// Small key/value store per clinic (table engine_state): last poll time, failure counters, alert marks.

export async function getState<T = Json>(db: Db, clinicId: string, key: string): Promise<T | null> {
  const { data } = await db.from("engine_state").select("value").eq("clinic_id", clinicId).eq("key", key).maybeSingle();
  return (data?.value as T | undefined) ?? null;
}

export async function setState(db: Db, clinicId: string, key: string, value: Json): Promise<void> {
  const { error } = await db
    .from("engine_state")
    .upsert({ clinic_id: clinicId, key, value, updated_at: new Date().toISOString() }, { onConflict: "clinic_id,key" });
  if (error) console.error(`Could not save engine state "${key}":`, error.message);
}
