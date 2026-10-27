import type { Metadata } from "next";
import Link from "next/link";
import { PageHeader } from "@/components/shell/page-header";
import { formatGBP, formatSlot } from "@/lib/format";
import { procedureLabel } from "@/lib/pricing";
import { isValidToken } from "@/lib/offers";
import { requireSession } from "@/lib/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { ActionButton } from "../../crm/card-actions";
import { approvePipeline, offerNextPatient } from "../../crm/actions";

// Reception opens this from the "Sarah K. said YES" email. The token only identifies the card;
// the signed-in session (and RLS) decide who may see and act on it. Source: guide §7 E6.
export const metadata: Metadata = { title: "Approve appointment", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border bg-card p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      <Link href="/crm" className="mt-4 inline-block text-sm font-medium text-primary underline-offset-4 hover:underline">
        Go to the pipeline
      </Link>
    </div>
  );
}

export default async function ApprovePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { clinic } = await requireSession();

  let content: React.ReactNode;
  const supabase = await createSupabaseServerClient();
  const { data: card } = isValidToken(token)
    ? await supabase
        .from("recovery_pipeline")
        .select("id, stage, procedure_price, waitlist_patient_id, cancellation_event_id, approved_at")
        .eq("approval_token", token)
        .eq("clinic_id", clinic.id)
        .maybeSingle()
    : { data: null };

  if (!card) {
    content = <Notice title="This approval link is not valid" body="It may belong to another clinic, or the card was removed. Open the pipeline to see what needs attention." />;
  } else if (card.stage === "slot_recovered") {
    content = <Notice title="Already approved" body="This appointment was approved, so there is nothing more to do here. Remember to book it in Dentally and tap Booked on the card." />;
  } else if (card.stage !== "waiting_staff_approval") {
    content = <Notice title="This card has moved on" body="The patient is no longer waiting for approval (the offer may have been passed on or the slot closed)." />;
  } else {
    const [{ data: event }, { data: patient }] = await Promise.all([
      supabase.from("cancellation_events").select("slot_datetime, procedure_type, doctor_name").eq("id", card.cancellation_event_id).maybeSingle(),
      card.waitlist_patient_id
        ? supabase.from("waitlist").select("patient_name, phone").eq("id", card.waitlist_patient_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    content = (
      <section className="flex max-w-lg flex-col gap-4 rounded-lg border bg-card p-5">
        <h2 className="text-xl font-semibold">{patient?.patient_name ?? "A patient"} said YES</h2>
        <dl className="grid grid-cols-[7rem_1fr] gap-y-2 text-sm">
          <dt className="text-muted-foreground">Phone</dt>
          <dd className="font-medium">{patient?.phone ?? "—"}</dd>
          <dt className="text-muted-foreground">Slot</dt>
          <dd className="font-medium">{event ? formatSlot(event.slot_datetime, clinic.timezone) : "—"}</dd>
          <dt className="text-muted-foreground">Treatment</dt>
          <dd className="font-medium">{event?.procedure_type ? procedureLabel(event.procedure_type) : "—"}</dd>
          <dt className="text-muted-foreground">Dentist</dt>
          <dd className="font-medium">{event?.doctor_name ?? "Any"}</dd>
          {card.procedure_price !== null ? (
            <>
              <dt className="text-muted-foreground">Value</dt>
              <dd className="font-medium">{formatGBP(card.procedure_price)}</dd>
            </>
          ) : null}
        </dl>
        <div className="flex flex-col gap-2 sm:max-w-xs">
          <ActionButton action={approvePipeline} pipelineId={card.id} label="Approve" pendingText="Approving…" />
          <ActionButton action={offerNextPatient} pipelineId={card.id} label="Offer to next patient" pendingText="Working…" variant="outline" />
        </div>
      </section>
    );
  }

  return (
    <>
      <PageHeader title="Approve appointment" description="A waitlist patient has answered YES." />
      {content}
    </>
  );
}
