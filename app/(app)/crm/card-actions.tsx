"use client";

import * as React from "react";
import { useActionState } from "react";
import { Check, Copy } from "lucide-react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import type { FormState } from "@/lib/form-state";
import { formatSlot } from "@/lib/format";
import { approvePipeline, markPipelineBooked, offerNextPatient, startOffersNow } from "./actions";
import type { BoardCard } from "./board";

type CardAction = (prev: FormState, formData: FormData) => Promise<FormState>;

/** One button that runs a server action for a card and shows its answer underneath. */
export function ActionButton({
  action,
  pipelineId,
  label,
  pendingText,
  variant,
}: {
  action: CardAction;
  pipelineId: string;
  label: string;
  pendingText: string;
  variant?: ButtonProps["variant"];
}) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="pipeline_id" value={pipelineId} />
      <SubmitButton size="sm" variant={variant} pendingText={pendingText}>
        {label}
      </SubmitButton>
      {state?.error ? (
        <p role="alert" className="text-xs text-destructive">
          {state.error}
        </p>
      ) : state?.message ? (
        <p role="status" className="text-xs text-muted-foreground">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

function CopyLinkButton({ link }: { link: string }) {
  const [copied, setCopied] = React.useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; nothing else to do.
    }
  }
  return (
    <Button type="button" variant="outline" size="sm" onClick={copy} aria-live="polite">
      {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
      {copied ? "Copied" : "Copy offer link"}
    </Button>
  );
}

/** The buttons that belong to a card's stage. "Close card" is added by the board. */
export function CardActions({ card, timezone }: { card: BoardCard; timezone: string }) {
  if (card.stage === "cancellation_detected") {
    return <ActionButton action={startOffersNow} pipelineId={card.id} label="Start offers" pendingText="Starting…" />;
  }

  if (card.stage === "offer_sent") {
    return card.offerLink ? <CopyLinkButton link={card.offerLink} /> : null;
  }

  if (card.stage === "waiting_staff_approval") {
    return (
      <div className="flex flex-col gap-2">
        <ActionButton action={approvePipeline} pipelineId={card.id} label="Approve" pendingText="Approving…" />
        <ActionButton action={offerNextPatient} pipelineId={card.id} label="Offer to next patient" pendingText="Working…" variant="outline" />
      </div>
    );
  }

  if (card.stage === "slot_recovered") {
    return (
      <div className="flex flex-col gap-2">
        <div className="rounded-md border border-dashed bg-secondary/60 p-2 text-xs">
          <p className="mb-1 font-medium text-foreground">Book in Dentally</p>
          <ul className="flex flex-col gap-0.5 text-muted-foreground">
            <li>Patient: {card.patientName ?? "—"}</li>
            <li>Phone: {card.patientPhone ?? "—"}</li>
            <li>Slot: {formatSlot(card.slotIso, timezone)}</li>
            <li>Dentist: {card.doctor ?? "Any"}</li>
            <li>Treatment: {card.procedure}</li>
          </ul>
        </div>
        {card.bookedAtIso ? (
          <p className="flex items-center gap-1 text-xs font-medium text-green-700">
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            Booked in Dentally
          </p>
        ) : (
          <ActionButton action={markPipelineBooked} pipelineId={card.id} label="Booked ✓" pendingText="Saving…" variant="outline" />
        )}
      </div>
    );
  }

  return null;
}
