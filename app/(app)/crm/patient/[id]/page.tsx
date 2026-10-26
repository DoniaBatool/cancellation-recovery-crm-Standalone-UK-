import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StageBadge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, PageHeader } from "@/components/shell/page-header";
import { STAGES, type Stage } from "@/lib/constants";
import { formatGBP, formatSlot } from "@/lib/format";
import { procedureLabel } from "@/lib/pricing";
import { requireSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { z } from "zod";

export const metadata: Metadata = { title: "Patient" };

const RESPONSE_LABELS: Record<string, string> = {
  pending: "Waiting for a reply",
  accepted: "Said yes",
  declined: "Said no",
  expired: "No reply (expired)",
};
const VIA_LABELS: Record<string, string> = {
  link: "Link",
  sms_reply: "SMS reply",
  whatsapp: "WhatsApp",
  crm: "Reception",
};

function List({ label, values }: { label: string; values: string[] }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{values.length ? values.join(", ") : "Any"}</dd>
    </div>
  );
}

export default async function PatientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const { clinic } = await requireSession();
  const supabase = await createSupabaseServerClient();

  const { data: patient } = await supabase
    .from("waitlist")
    .select("*")
    .eq("id", id)
    .eq("clinic_id", clinic.id)
    .maybeSingle();
  if (!patient) notFound();

  const [{ data: offers }, { data: messages }] = await Promise.all([
    supabase
      .from("waitlist_offers")
      .select("id, pipeline_id, offered_at, response, responded_via, responded_at")
      .eq("waitlist_patient_id", id)
      .order("offered_at", { ascending: false })
      .limit(50),
    supabase
      .from("messages")
      .select("id, channel, direction, body, status, created_at")
      .eq("waitlist_patient_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const pipelineIds = [...new Set((offers ?? []).map((o) => o.pipeline_id))];

  const { data: pipelines } = pipelineIds.length
    ? await supabase
        .from("recovery_pipeline")
        .select("id, stage, cancellation_event_id, revenue_saved, waitlist_patient_id")
        .in("id", pipelineIds)
    : { data: [] };
  const eventIds = [...new Set((pipelines ?? []).map((p) => p.cancellation_event_id))];
  const { data: events } = eventIds.length
    ? await supabase.from("cancellation_events").select("id, slot_datetime, procedure_type, doctor_name").in("id", eventIds)
    : { data: [] };

  const pipelineById = new Map((pipelines ?? []).map((p) => [p.id, p]));
  const eventById = new Map((events ?? []).map((e) => [e.id, e]));
  const recoveries = (pipelines ?? []).filter((p) => p.stage === "slot_recovered" && p.waitlist_patient_id === id);

  return (
    <>
      <Link href="/crm/waitlist" className="mb-3 inline-flex items-center gap-1 text-sm text-link underline-offset-4 hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to waitlist
      </Link>
      <PageHeader
        title={patient.patient_name}
        description={patient.is_active ? "Active on the waitlist" : "Paused: not offered any slots"}
        actions={patient.sms_opt_out ? <Badge tone="warning">Opted out of SMS</Badge> : undefined}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Phone</dt>
                <dd className="mt-0.5 text-sm">
                  {patient.phone ? (
                    <a href={`tel:${patient.phone}`} className="text-link underline-offset-4 hover:underline">
                      {patient.phone}
                    </a>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Email</dt>
                <dd className="mt-0.5 break-all text-sm">{patient.email ?? "—"}</dd>
              </div>
              <List label="Treatments" values={patient.preferred_procedures} />
              <List label="Dentists" values={patient.preferred_doctors} />
              <List label="Days" values={patient.preferred_days} />
              <List label="Times" values={patient.preferred_times} />
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Minimum notice</dt>
                <dd className="mt-0.5 text-sm">{patient.max_notice_hours === 0 ? "Same day" : `${patient.max_notice_hours} hours`}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Existing patient</dt>
                <dd className="mt-0.5 text-sm">{patient.existing_patient ? "Yes" : "No"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Notes</dt>
                <dd className="mt-0.5 whitespace-pre-wrap text-sm">{patient.notes || "—"}</dd>
              </div>
              <div className="sm:col-span-2 text-xs text-muted-foreground">
                Added {formatSlot(patient.created_at, clinic.timezone)} by {patient.added_by ?? "unknown"}
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recovered slots</CardTitle>
          </CardHeader>
          <CardContent>
            {recoveries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recovered slots yet.</p>
            ) : (
              <ul className="flex flex-col gap-2 text-sm">
                {recoveries.map((p) => {
                  const e = eventById.get(p.cancellation_event_id);
                  return (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2">
                      <span>
                        {e ? formatSlot(e.slot_datetime, clinic.timezone) : "Slot"} · {procedureLabel(e?.procedure_type)}
                      </span>
                      <span className="font-medium">{formatGBP(p.revenue_saved ?? 0)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold">Offer history</h2>
      {(offers ?? []).length === 0 ? (
        <EmptyState title="This patient hasn't been offered a slot yet." />
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <tr className="border-b">
                <TableHead>Slot</TableHead>
                <TableHead>Offered</TableHead>
                <TableHead>Response</TableHead>
                <TableHead>Via</TableHead>
                <TableHead>Card</TableHead>
              </tr>
            </TableHeader>
            <TableBody>
              {(offers ?? []).map((o) => {
                const p = pipelineById.get(o.pipeline_id);
                const e = p ? eventById.get(p.cancellation_event_id) : undefined;
                const stage = p && (STAGES as readonly string[]).includes(p.stage) ? (p.stage as Stage) : null;
                return (
                  <TableRow key={o.id}>
                    <TableCell>{e ? `${formatSlot(e.slot_datetime, clinic.timezone)} · ${procedureLabel(e.procedure_type)}` : "—"}</TableCell>
                    <TableCell>{formatSlot(o.offered_at, clinic.timezone)}</TableCell>
                    <TableCell>{RESPONSE_LABELS[o.response] ?? o.response}</TableCell>
                    <TableCell>{o.responded_via ? (VIA_LABELS[o.responded_via] ?? o.responded_via) : "—"}</TableCell>
                    <TableCell>{stage ? <StageBadge stage={stage} /> : "—"}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <h2 className="mb-3 mt-8 text-lg font-semibold">Messages</h2>
      {(messages ?? []).length === 0 ? (
        <EmptyState title="No messages sent or received yet." />
      ) : (
        <ul className="flex flex-col gap-2">
          {(messages ?? []).map((m) => (
            <li key={m.id} className="rounded-md border bg-card px-3 py-2 text-sm">
              <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge>{m.channel.toUpperCase()}</Badge>
                <span>{m.direction === "inbound" ? "Received" : "Sent"}</span>
                <span>{formatSlot(m.created_at, clinic.timezone)}</span>
                {m.status ? <span>· {m.status}</span> : null}
              </div>
              <p className="whitespace-pre-wrap">{m.body}</p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
