"use client";

import * as React from "react";
import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Form } from "@/components/ui/form";
import { ChoiceChips } from "@/components/ui/choice-chips";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Textarea } from "@/components/ui/form-controls";
import { SubmitButton } from "@/components/ui/submit-button";
import { Button } from "@/components/ui/button";
import { PROCEDURES, TIMES_OF_DAY, WEEKDAYS } from "@/lib/constants";
import type { Doctor } from "@/lib/validation";
import { saveWaitlistPatient } from "./actions";

export type WaitlistRow = {
  id: string;
  patient_name: string;
  email: string | null;
  phone: string | null;
  preferred_procedures: string[];
  preferred_days: string[];
  preferred_times: string[];
  preferred_doctors: string[];
  max_notice_hours: number;
  existing_patient: boolean;
  notes: string | null;
  is_active: boolean;
  sms_opt_out: boolean;
  opt_in_source: string;
  last_contacted_at: string | null;
};

const label = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);
const PROCEDURE_OPTIONS = PROCEDURES.map((p) => ({ value: p, label: label(p) }));
const DAY_OPTIONS = WEEKDAYS.map((d) => ({ value: d, label: d.slice(0, 3) }));
const TIME_OPTIONS = TIMES_OF_DAY.map((t) => ({ value: t, label: label(t) }));

/** Add (patient = null) or edit a waitlist patient. */
export function PatientFormDialog({
  open,
  onOpenChange,
  patient,
  doctors,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  patient: WaitlistRow | null;
  doctors: Doctor[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={patient ? "Edit patient" : "Add patient"}
        description="Add a phone number or an email address (or both)."
      >
        {/* Keyed so the form (and its action state) resets for each patient. */}
        <PatientForm key={patient?.id ?? "new"} patient={patient} doctors={doctors} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function PatientForm({
  patient,
  doctors,
  onDone,
}: {
  patient: WaitlistRow | null;
  doctors: Doctor[];
  onDone: () => void;
}) {
  const [state, formAction] = useActionState(saveWaitlistPatient, null);

  React.useEffect(() => {
    if (state?.message) onDone();
    // onDone changes identity on every render of the parent; only the result matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Form action={formAction} noValidate className="flex flex-col gap-4">
      {patient ? <input type="hidden" name="id" value={patient.id} /> : null}
      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}

      <Field id="patient_name" label="Name" error={state?.fieldErrors?.patient_name}>
        {(aria) => <Input {...aria} name="patient_name" defaultValue={patient?.patient_name} required autoComplete="off" />}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="phone" label="Mobile phone" error={state?.fieldErrors?.phone} hint="UK numbers, e.g. 07700 900123">
          {(aria) => <Input {...aria} name="phone" type="tel" inputMode="tel" defaultValue={patient?.phone ?? ""} autoComplete="off" />}
        </Field>
        <Field id="email" label="Email" error={state?.fieldErrors?.email}>
          {(aria) => <Input {...aria} name="email" type="email" inputMode="email" defaultValue={patient?.email ?? ""} autoComplete="off" />}
        </Field>
      </div>

      <ChoiceChips
        legend="Treatments wanted (none = any)"
        name="preferred_procedures"
        options={PROCEDURE_OPTIONS}
        defaultValue={patient?.preferred_procedures}
      />
      <ChoiceChips legend="Days (none = any)" name="preferred_days" options={DAY_OPTIONS} defaultValue={patient?.preferred_days} />
      <ChoiceChips legend="Times (none = any)" name="preferred_times" options={TIME_OPTIONS} defaultValue={patient?.preferred_times} />
      {doctors.length > 0 ? (
        <ChoiceChips
          legend="Preferred dentists (none = any)"
          name="preferred_doctors"
          options={doctors.map((d) => ({ value: d.name, label: d.name }))}
          defaultValue={patient?.preferred_doctors}
        />
      ) : null}

      <Field
        id="max_notice_hours"
        label="Minimum notice (hours)"
        hint="0 = happy to come in at short notice. Up to 336 (two weeks)."
        error={state?.fieldErrors?.max_notice_hours}
      >
        {(aria) => (
          <Input {...aria} name="max_notice_hours" type="number" min={0} max={336} step={1} inputMode="numeric" defaultValue={patient?.max_notice_hours ?? 0} required />
        )}
      </Field>

      <label className="flex min-h-10 items-center gap-2 text-sm">
        <input type="checkbox" name="existing_patient" defaultChecked={patient?.existing_patient ?? false} className="h-4 w-4" />
        Already a patient at this clinic
      </label>

      <Field id="notes" label="Notes (optional)" error={state?.fieldErrors?.notes}>
        {(aria) => <Textarea {...aria} name="notes" defaultValue={patient?.notes ?? ""} maxLength={1000} />}
      </Field>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <SubmitButton pendingText="Saving…">{patient ? "Save changes" : "Add patient"}</SubmitButton>
      </div>
    </Form>
  );
}
