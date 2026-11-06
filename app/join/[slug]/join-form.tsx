"use client";

import { useActionState, useState, useTransition } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Form } from "@/components/ui/form";
import { ChoiceChips } from "@/components/ui/choice-chips";
import { Field, Input, NativeSelect } from "@/components/ui/form-controls";
import { SubmitButton } from "@/components/ui/submit-button";
import { NOTICE_OPTIONS, PROCEDURES, TIMES_OF_DAY, WEEKDAYS } from "@/lib/constants";
import { answerSmsPreference, joinClinicWaitlist } from "./actions";

const cap = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);

function SmsQuestion({ slug, patientId }: { slug: string; patientId: string }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  if (result) {
    return (
      <Alert tone={result.ok ? "success" : "error"}>{result.message}</Alert>
    );
  }

  const answer = (value: "yes" | "no") => start(async () => setResult(await answerSmsPreference(slug, patientId, value)));

  return (
    <div className="flex flex-col gap-3 border-t pt-4 text-left">
      <p className="font-medium">You asked us to stop texts earlier. Do you want text offers again?</p>
      <div className="flex gap-2">
        <Button type="button" className="h-11 flex-1" disabled={pending} onClick={() => answer("yes")}>
          Yes, text me
        </Button>
        <Button type="button" variant="outline" className="h-11 flex-1" disabled={pending} onClick={() => answer("no")}>
          No, email only
        </Button>
      </div>
    </div>
  );
}

export function JoinForm({
  slug,
  src,
  clinicName,
  doctors,
  privacyUrl,
}: {
  slug: string;
  src?: string;
  clinicName: string;
  doctors: string[];
  privacyUrl: string | null;
}) {
  const [state, formAction] = useActionState(joinClinicWaitlist.bind(null, slug, src), null);

  if (state?.message) {
    return (
      <div role="status" className="flex flex-col items-center gap-3 rounded-lg border bg-card p-8 text-center">
        <CheckCircle2 className="h-10 w-10 text-green-700" aria-hidden="true" />
        <h2 className="text-xl font-semibold">You&apos;re on the list.</h2>
        <p className="text-muted-foreground">We&apos;ll be in touch when a slot opens.</p>
        {state.askSmsPreference ? <SmsQuestion slug={slug} patientId={state.askSmsPreference.patientId} /> : null}
      </div>
    );
  }

  const errors = state?.fieldErrors;

  return (
    <Form action={formAction} noValidate className="flex flex-col gap-5">
      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}

      {/* Honeypot: hidden from people and screen readers, bots fill it. */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="website">Website</label>
        <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      <Field id="patient_name" label="Full name" error={errors?.patient_name}>
        {(aria) => <Input {...aria} name="patient_name" autoComplete="name" required className="h-11" />}
      </Field>
      <Field id="phone" label="Mobile number" error={errors?.phone} hint="We'll text you when a slot opens.">
        {(aria) => <Input {...aria} name="phone" type="tel" inputMode="tel" autoComplete="tel" required className="h-11" />}
      </Field>
      <Field id="email" label="Email address" error={errors?.email}>
        {(aria) => <Input {...aria} name="email" type="email" inputMode="email" autoComplete="email" required className="h-11" />}
      </Field>

      <ChoiceChips large legend="Treatments you want (leave empty for any)" name="preferred_procedures" options={PROCEDURES.map((p) => ({ value: p, label: cap(p) }))} />
      <ChoiceChips large legend="Days that suit you (leave empty for any)" name="preferred_days" options={WEEKDAYS.map((d) => ({ value: d, label: d.slice(0, 3) }))} />
      <ChoiceChips large legend="Times that suit you (leave empty for any)" name="preferred_times" options={TIMES_OF_DAY.map((t) => ({ value: t, label: cap(t) }))} />
      {doctors.length > 0 ? (
        <ChoiceChips large legend="Preferred dentist (leave empty for any)" name="preferred_doctors" options={doctors.map((d) => ({ value: d, label: d }))} />
      ) : null}

      <Field id="max_notice_hours" label="How much notice do you need?" error={errors?.max_notice_hours}>
        {(aria) => (
          <NativeSelect {...aria} name="max_notice_hours" defaultValue="" required className="h-11">
            <option value="" disabled>
              Choose…
            </option>
            {NOTICE_OPTIONS.map((o) => (
              <option key={o.hours} value={o.hours}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>

      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" name="existing_patient" className="h-5 w-5" />I&apos;m already a patient here
      </label>

      <div className="flex flex-col gap-1.5">
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="consent" required aria-invalid={errors?.consent ? true : undefined} className="mt-0.5 h-5 w-5 shrink-0" />
          <span>
            I&apos;m happy for {clinicName} to contact me by text and email about earlier appointments. I can reply STOP at any time.
          </span>
        </label>
        {errors?.consent ? <p className="text-sm text-destructive">{errors.consent}</p> : null}
        {privacyUrl ? (
          <p className="text-sm text-muted-foreground">
            How we use your details:{" "}
            <a href={privacyUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
              read {clinicName}&apos;s privacy notice
            </a>
            .
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Ask the practice if you want to know how your details are used.</p>
        )}
      </div>

      <SubmitButton size="lg" pendingText="Joining…">
        Join the list
      </SubmitButton>
    </Form>
  );
}
