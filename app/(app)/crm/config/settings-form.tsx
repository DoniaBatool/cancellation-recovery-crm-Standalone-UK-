"use client";

import * as React from "react";
import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Form } from "@/components/ui/form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChoiceChips } from "@/components/ui/choice-chips";
import { Field, Input, NativeSelect, Switch } from "@/components/ui/form-controls";
import { SubmitButton } from "@/components/ui/submit-button";
import { PROCEDURES } from "@/lib/constants";
import type { Doctor } from "@/lib/validation";
import { saveClinicConfig } from "./actions";
import { DoctorsEditor } from "./doctors-editor";

export type ConfigValues = {
  contact_email: string;
  prices: Record<string, number>;
  doctors: Doctor[];
  engine_enabled: boolean;
  shadow_mode: boolean;
  slack_enabled: boolean;
  offer_channels: string[];
  offer_expiry_minutes: number;
  offer_strategy: string;
  batch_size: number;
  max_offers_per_slot: number;
  min_lead_minutes: number;
  max_horizon_hours: number;
  approval_window_minutes: number;
  quiet_hours_start: string;
  quiet_hours_end: string;
};

const CHANNELS = [
  { value: "sms", label: "SMS" },
  { value: "email", label: "Email" },
];

function ToggleRow({
  name,
  label,
  hint,
  defaultChecked,
}: {
  name: string;
  label: string;
  hint: string;
  defaultChecked: boolean;
}) {
  const id = `toggle-${name}`;
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} name={name} defaultChecked={defaultChecked} />
    </div>
  );
}

export function SettingsForm({ values, canEdit }: { values: ConfigValues; canEdit: boolean }) {
  const [state, formAction] = useActionState(saveClinicConfig, null);
  const errors = state?.fieldErrors;

  return (
    <Form action={formAction} noValidate className="flex flex-col gap-6">
      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state?.message ? <Alert tone="success">{state.message}</Alert> : null}
      {!canEdit ? <Alert tone="info">You can view the settings. Only the owner or an admin can change them.</Alert> : null}

      {/* A disabled fieldset makes every control read-only for staff. */}
      <fieldset disabled={!canEdit} className="flex flex-col gap-6 border-0 p-0">
        <Card>
          <CardHeader>
            <CardTitle>Reception email</CardTitle>
            <CardDescription>Copied on every booking email. Also receives approval requests and alerts.</CardDescription>
          </CardHeader>
          <CardContent>
            <Field id="contact_email" label="Email address" error={errors?.contact_email}>
              {(aria) => (
                <Input {...aria} name="contact_email" type="email" inputMode="email" defaultValue={values.contact_email} placeholder="reception@clinic.co.uk" />
              )}
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Procedure prices (£)</CardTitle>
            <CardDescription>Used to work out the value of each recovered slot. Whole pounds.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {PROCEDURES.map((p) => (
              <Field key={p} id={`price_${p}`} label={p.charAt(0).toUpperCase() + p.slice(1)} error={errors?.[`price_${p}`]}>
                {(aria) => <Input {...aria} name={`price_${p}`} type="number" min={0} step={1} inputMode="numeric" defaultValue={values.prices[p]} required />}
              </Field>
            ))}
            <Field id="price_default" label="Any other / not specified" error={errors?.price_default}>
              {(aria) => <Input {...aria} name="price_default" type="number" min={0} step={1} inputMode="numeric" defaultValue={values.prices.default} required />}
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Dentists</CardTitle>
            <CardDescription>Used for the preferred-dentist choices on the waitlist and for dentist emails.</CardDescription>
          </CardHeader>
          <CardContent>
            <DoctorsEditor initial={values.doctors} error={errors?.doctors} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recovery engine</CardTitle>
            <CardDescription>How offers are sent when a slot opens.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <ToggleRow
              name="engine_enabled"
              label="Engine on"
              hint="When off, cancellations are recorded but no offers are sent."
              defaultChecked={values.engine_enabled}
            />
            <ToggleRow
              name="shadow_mode"
              label="Shadow mode"
              hint="Works out who would be offered each slot, but sends nothing. Good for a first week."
              defaultChecked={values.shadow_mode}
            />
            <ToggleRow
              name="slack_enabled"
              label="Slack alerts"
              hint="Send approval requests to the clinic's Slack channel (set up later)."
              defaultChecked={values.slack_enabled}
            />

            <div>
              <ChoiceChips legend="Send offers by" name="offer_channels" options={CHANNELS} defaultValue={values.offer_channels} />
              {errors?.offer_channels ? <p className="mt-1.5 text-sm text-destructive">{errors.offer_channels}</p> : null}
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field id="offer_strategy" label="Strategy" error={errors?.offer_strategy} hint="One patient at a time, or a small group at once.">
                {(aria) => (
                  <NativeSelect {...aria} name="offer_strategy" defaultValue={values.offer_strategy}>
                    <option value="sequential">One at a time</option>
                    <option value="batch">Batch</option>
                  </NativeSelect>
                )}
              </Field>
              <Field id="batch_size" label="Batch size" error={errors?.batch_size} hint="Used when strategy is Batch (2–10).">
                {(aria) => <Input {...aria} name="batch_size" type="number" min={2} max={10} inputMode="numeric" defaultValue={values.batch_size} />}
              </Field>
              <Field id="offer_expiry_minutes" label="Offer expires after (minutes)" error={errors?.offer_expiry_minutes}>
                {(aria) => <Input {...aria} name="offer_expiry_minutes" type="number" min={5} max={1440} inputMode="numeric" defaultValue={values.offer_expiry_minutes} />}
              </Field>
              <Field id="max_offers_per_slot" label="Max offers per slot" error={errors?.max_offers_per_slot}>
                {(aria) => <Input {...aria} name="max_offers_per_slot" type="number" min={1} max={20} inputMode="numeric" defaultValue={values.max_offers_per_slot} />}
              </Field>
              <Field id="min_lead_minutes" label="Minimum lead time (minutes)" error={errors?.min_lead_minutes} hint="Slots starting sooner are not offered.">
                {(aria) => <Input {...aria} name="min_lead_minutes" type="number" min={0} inputMode="numeric" defaultValue={values.min_lead_minutes} />}
              </Field>
              <Field id="max_horizon_hours" label="Look-ahead (hours)" error={errors?.max_horizon_hours} hint="Slots further away are not offered.">
                {(aria) => <Input {...aria} name="max_horizon_hours" type="number" min={1} inputMode="numeric" defaultValue={values.max_horizon_hours} />}
              </Field>
              <Field id="approval_window_minutes" label="Approval window (minutes)" error={errors?.approval_window_minutes}>
                {(aria) => <Input {...aria} name="approval_window_minutes" type="number" min={1} inputMode="numeric" defaultValue={values.approval_window_minutes} />}
              </Field>
              <Field id="quiet_hours_start" label="Quiet hours start" error={errors?.quiet_hours_start} hint="No texts between these times.">
                {(aria) => <Input {...aria} name="quiet_hours_start" type="time" defaultValue={values.quiet_hours_start} required />}
              </Field>
              <Field id="quiet_hours_end" label="Quiet hours end" error={errors?.quiet_hours_end}>
                {(aria) => <Input {...aria} name="quiet_hours_end" type="time" defaultValue={values.quiet_hours_end} required />}
              </Field>
            </div>
          </CardContent>
        </Card>
      </fieldset>

      {canEdit ? (
        <div>
          <SubmitButton pendingText="Saving…">Save settings</SubmitButton>
        </div>
      ) : null}
    </Form>
  );
}
