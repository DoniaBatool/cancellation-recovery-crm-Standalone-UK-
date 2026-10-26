"use client";

import * as React from "react";
import { useActionState } from "react";
import { Plus } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Form } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input, NativeSelect } from "@/components/ui/form-controls";
import { SubmitButton } from "@/components/ui/submit-button";
import { PROCEDURES } from "@/lib/constants";
import type { Doctor } from "@/lib/validation";
import { addManualCancellation } from "./actions";

/** "Add cancellation": works for any practice system, no integration needed. */
export function AddCancellationDialog({ doctors, today }: { doctors: Doctor[]; today: string }) {
  const [open, setOpen] = React.useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add cancellation
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Add a cancellation"
        description="Enter the appointment that was cancelled. Times are in the clinic's local time."
      >
        <AddForm doctors={doctors} today={today} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function AddForm({ doctors, today, onDone }: { doctors: Doctor[]; today: string; onDone: () => void }) {
  const [state, formAction] = useActionState(addManualCancellation, null);

  React.useEffect(() => {
    if (state?.message) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const errors = state?.fieldErrors;

  return (
    <Form action={formAction} noValidate className="flex flex-col gap-4">
      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="slot_date" label="Date" error={errors?.slot_date}>
          {(aria) => <Input {...aria} name="slot_date" type="date" defaultValue={today} required />}
        </Field>
        <Field id="slot_time" label="Start time" error={errors?.slot_time}>
          {(aria) => <Input {...aria} name="slot_time" type="time" required />}
        </Field>
        <Field id="slot_duration_minutes" label="Length (minutes)" error={errors?.slot_duration_minutes}>
          {(aria) => <Input {...aria} name="slot_duration_minutes" type="number" min={5} max={480} step={5} inputMode="numeric" defaultValue={30} required />}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="procedure_type" label="Treatment" error={errors?.procedure_type}>
          {(aria) => (
            <NativeSelect {...aria} name="procedure_type" defaultValue="">
              <option value="">Not specified</option>
              {PROCEDURES.map((p) => (
                <option key={p} value={p}>
                  {p.charAt(0).toUpperCase() + p.slice(1)}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        <Field id="doctor_id" label="Dentist" error={errors?.doctor_id}>
          {(aria) => (
            <NativeSelect {...aria} name="doctor_id" defaultValue="">
              <option value="">Not specified</option>
              {doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      </div>
      <Field id="cancelled_patient_name" label="Cancelled patient (optional)" error={errors?.cancelled_patient_name}>
        {(aria) => <Input {...aria} name="cancelled_patient_name" autoComplete="off" />}
      </Field>
      <Field id="cancellation_reason" label="Reason (optional)" error={errors?.cancellation_reason}>
        {(aria) => <Input {...aria} name="cancellation_reason" autoComplete="off" />}
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <SubmitButton pendingText="Adding…">Add cancellation</SubmitButton>
      </div>
    </Form>
  );
}
