"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { Phone } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Form } from "@/components/ui/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/form-controls";
import { SubmitButton } from "@/components/ui/submit-button";
import { STAGES, STAGE_HINTS, STAGE_SHORT_LABELS, STAGE_TONES, type Stage } from "@/lib/constants";
import { formatGBP, formatSlot } from "@/lib/format";
import { minutesBetween, formatDuration } from "@/lib/time";
import { cn } from "@/lib/cn";
import { markExpired } from "./actions";
import { CardActions } from "./card-actions";

export type BoardCard = {
  id: string;
  stage: Stage;
  slotIso: string;
  procedure: string;
  doctor: string | null;
  cancelledPatient: string | null;
  patientId: string | null;
  patientName: string | null;
  patientPhone: string | null;
  value: number | null;
  sinceIso: string;
  offerExpiresIso: string | null;
  offeredCount: number;
  notes: string | null;
  /** Link of the open offer, for reception to share by hand. */
  offerLink: string | null;
  bookedAtIso: string | null;
};

const REFRESH_MS = 30_000;

export function Board({ cards, timezone }: { cards: BoardCard[]; timezone: string }) {
  const router = useRouter();
  const [now, setNow] = React.useState<number | null>(null);
  const [closing, setClosing] = React.useState<BoardCard | null>(null);

  // Refresh the data and the clocks every 30 s. `now` starts empty so the server and client
  // render the same HTML, then fills in after hydration.
  React.useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => {
      setNow(Date.now());
      router.refresh();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [router]);

  return (
    <>
      <div className="-mx-4 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">
        <div className="grid min-w-[56rem] grid-cols-5 gap-3">
          {STAGES.map((stage) => {
            const inStage = cards.filter((c) => c.stage === stage);
            const hint = STAGE_HINTS[stage];
            return (
              <section key={stage} aria-labelledby={`col-${stage}`} title={hint} className="flex min-h-64 flex-col rounded-lg border bg-secondary/60 p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 id={`col-${stage}`} className="text-sm font-semibold text-foreground">
                    {STAGE_SHORT_LABELS[stage]}
                  </h2>
                  <Badge tone={STAGE_TONES[stage]} aria-label={`${inStage.length} cards`}>
                    {inStage.length}
                  </Badge>
                </div>
                {hint ? <p className="mb-3 text-xs text-muted-foreground">{hint}</p> : null}
                {inStage.length === 0 ? (
                  <p className="mt-auto text-center text-xs text-muted-foreground">No cards</p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {inStage.map((card) => (
                      <li key={card.id}>
                        <CardView card={card} timezone={timezone} now={now} onClose={() => setClosing(card)} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </div>
      <CloseDialog card={closing} timezone={timezone} onClose={() => setClosing(null)} />
    </>
  );
}

function CardView({
  card,
  timezone,
  now,
  onClose,
}: {
  card: BoardCard;
  timezone: string;
  now: number | null;
  onClose: () => void;
}) {
  const open = card.stage !== "slot_recovered" && card.stage !== "expired_manual";
  const waitingApproval = card.stage === "waiting_staff_approval";
  const minsInStage = now === null ? null : minutesBetween(card.sinceIso, new Date(now));
  const minsToExpiry = now === null || !card.offerExpiresIso ? null : Math.ceil((new Date(card.offerExpiresIso).getTime() - now) / 60000);

  return (
    <article
      className={cn(
        "rounded-md border bg-card p-3 text-sm shadow-sm",
        waitingApproval && "border-amber-300 bg-amber-50",
      )}
    >
      <p className="font-medium text-foreground">{formatSlot(card.slotIso, timezone)}</p>
      <p className="text-muted-foreground">
        {card.procedure}
        {card.doctor ? ` · ${card.doctor}` : ""}
      </p>
      {card.cancelledPatient ? <p className="mt-1 text-xs text-muted-foreground">Cancelled by {card.cancelledPatient}</p> : null}

      {card.patientName ? (
        <p className="mt-2">
          {card.patientId ? (
            <Link href={`/crm/patient/${card.patientId}`} className="font-medium text-link underline-offset-4 hover:underline">
              {card.patientName}
            </Link>
          ) : (
            <span className="font-medium">{card.patientName}</span>
          )}
        </p>
      ) : null}
      {(waitingApproval || card.stage === "slot_recovered") && card.patientPhone ? (
        <a href={`tel:${card.patientPhone}`} className="mt-1 inline-flex min-h-8 items-center gap-1 text-link underline-offset-4 hover:underline">
          <Phone className="h-3.5 w-3.5" aria-hidden="true" />
          {card.patientPhone}
        </a>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{card.value !== null ? formatGBP(card.value) : "—"}</span>
        {minsInStage !== null ? <span>In stage {formatDuration(minsInStage)}</span> : null}
      </div>
      {minsToExpiry !== null && card.stage === "offer_sent" ? (
        <p className="mt-1 text-xs text-amber-800">{minsToExpiry > 0 ? `Offer expires in ${minsToExpiry} min` : "Offer has expired"}</p>
      ) : null}

      {card.stage === "expired_manual" ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {card.notes ? `${card.notes} · ` : ""}
          {card.offeredCount} {card.offeredCount === 1 ? "patient" : "patients"} offered
        </p>
      ) : null}

      <div className="mt-2 flex flex-col gap-2">
        <CardActions card={card} timezone={timezone} />
        {open ? (
          <Button variant="outline" size="sm" onClick={onClose}>
            Close card
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function CloseDialog({ card, timezone, onClose }: { card: BoardCard | null; timezone: string; onClose: () => void }) {
  return (
    <Dialog open={card !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      {card ? (
        <DialogContent title="Close this card?" description={`${formatSlot(card.slotIso, timezone)} · ${card.procedure}`}>
          <CloseForm key={card.id} card={card} onClose={onClose} />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

function CloseForm({ card, onClose }: { card: BoardCard; onClose: () => void }) {
  const [state, formAction] = useActionState(markExpired, null);

  React.useEffect(() => {
    if (state?.message) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Form action={formAction} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="pipeline_id" value={card.id} />
      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
      <p className="text-sm text-muted-foreground">
        Use this when no patient is needed any more, for example the slot was filled another way. The card moves to
        Expired / manual and no more offers go out.
      </p>
      <Field id="reason" label="Reason (optional)" error={state?.fieldErrors?.reason}>
        {(aria) => <Input {...aria} name="reason" maxLength={300} autoComplete="off" />}
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Keep card
        </Button>
        <SubmitButton pendingText="Closing…">Close card</SubmitButton>
      </div>
    </Form>
  );
}
