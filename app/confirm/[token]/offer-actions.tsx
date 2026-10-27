"use client";

import { useActionState } from "react";
import { CalendarX, CheckCircle2, Clock, ThumbsUp } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import type { OfferState } from "@/lib/offers";
import { respondAction, type RespondState } from "./actions";

export const STATE_MESSAGES: Record<Exclude<OfferState, "open">, { title: string; body: string }> = {
  accepted: {
    title: "Thank you, we've got your reply",
    body: "The practice will confirm your booking shortly.",
  },
  declined: {
    title: "No problem",
    body: "We'll keep you on the list for the next opening.",
  },
  expired: {
    title: "This offer has expired",
    body: "We'll be in touch when the next slot opens.",
  },
  slot_unavailable: {
    title: "This slot has been filled",
    body: "We'll keep you on the list for the next one.",
  },
};

export function StateMessage({ state }: { state: Exclude<OfferState, "open"> }) {
  const { title, body } = STATE_MESSAGES[state];
  const Icon = state === "accepted" ? CheckCircle2 : state === "declined" ? ThumbsUp : state === "expired" ? Clock : CalendarX;
  return (
    <div role="status" className="flex flex-col items-center gap-3 rounded-lg border bg-card p-6 text-center">
      <Icon className="h-10 w-10 text-primary" aria-hidden="true" />
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="text-muted-foreground">{body}</p>
    </div>
  );
}

export function OfferActions({ token }: { token: string }) {
  const [result, formAction] = useActionState<RespondState, FormData>(respondAction.bind(null, token), null);

  if (result && "state" in result && result.state !== "open") return <StateMessage state={result.state} />;

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {result && "error" in result ? <Alert tone="error">{result.error}</Alert> : null}
      <SubmitButton name="answer" value="accepted" size="lg" className="h-14 w-full text-base" pendingText="Sending…">
        Yes, book me in
      </SubmitButton>
      <SubmitButton name="answer" value="declined" variant="outline" size="lg" className="h-14 w-full text-base" pendingText="Sending…">
        No thanks
      </SubmitButton>
    </form>
  );
}
