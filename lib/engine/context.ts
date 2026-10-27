import type { Stage } from "@/lib/constants";
import { isStage } from "@/lib/constants";
import type { Tables } from "@/lib/database.types";
import type { Db } from "@/lib/pipeline";
import type { ClinicInfo, Notifier, SlotInfo } from "@/lib/engine/notifier";

// Shared loading for the engine: one card with its slot, clinic and settings.

export type EngineDeps = {
  db: Db;
  notifier: Notifier;
  now?: Date;
  /** Injected in tests; defaults to crypto.randomUUID. */
  uuid?: () => string;
  /**
   * Run slow follow-up work (confirmation emails) after the response has been sent.
   * A route passes next/server's `after`; without it the work is simply awaited.
   */
  defer?: (task: () => Promise<void>) => void;
};

export type PipelineRow = Tables<"recovery_pipeline">;
export type EventRow = Tables<"cancellation_events">;
export type ClinicRow = Tables<"clinics">;
export type ConfigRow = Tables<"clinic_config">;

export type Loaded = {
  pipeline: PipelineRow & { stage: Stage };
  event: EventRow;
  clinic: ClinicRow;
  config: ConfigRow;
};

export const nowOf = (deps: EngineDeps) => deps.now ?? new Date();
export const uuidOf = (deps: EngineDeps) => (deps.uuid ?? (() => crypto.randomUUID()))();

export async function loadPipeline(db: Db, pipelineId: string): Promise<Loaded | null> {
  const { data: pipeline } = await db.from("recovery_pipeline").select("*").eq("id", pipelineId).maybeSingle();
  if (!pipeline || !isStage(pipeline.stage)) return null;

  const [{ data: event }, { data: clinic }, { data: config }] = await Promise.all([
    db.from("cancellation_events").select("*").eq("id", pipeline.cancellation_event_id).maybeSingle(),
    db.from("clinics").select("*").eq("id", pipeline.clinic_id).maybeSingle(),
    db.from("clinic_config").select("*").eq("clinic_id", pipeline.clinic_id).maybeSingle(),
  ]);
  if (!event || !clinic || !config) return null;
  return { pipeline: { ...pipeline, stage: pipeline.stage }, event, clinic, config };
}

export function clinicInfo(clinic: ClinicRow): ClinicInfo {
  return {
    id: clinic.id,
    name: clinic.name,
    timezone: clinic.timezone,
    address: clinic.address,
    phone: clinic.contact_phone,
    contactEmail: clinic.contact_email,
  };
}

export function slotInfo(event: EventRow): SlotInfo {
  return {
    datetime: event.slot_datetime,
    durationMinutes: event.slot_duration_minutes,
    procedure: event.procedure_type,
    doctorName: event.doctor_name,
  };
}

/** "Sarah Khan" -> "Sarah K." for notes in the history log. */
export function shortName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) return parts[0] ?? name;
  return `${parts[0]} ${parts[parts.length - 1]?.charAt(0).toUpperCase()}.`;
}
