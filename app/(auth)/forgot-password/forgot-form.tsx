"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Field, Input } from "@/components/ui/form-controls";
import { SubmitButton } from "@/components/ui/submit-button";
import { forgotPasswordAction } from "@/app/(auth)/forgot-password/actions";

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(forgotPasswordAction, null);

  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state?.message ? <Alert tone="success">{state.message}</Alert> : null}

      <Field id="email" label="Email" error={state?.fieldErrors?.email}>
        {(aria) => <Input {...aria} name="email" type="email" autoComplete="email" inputMode="email" required autoFocus />}
      </Field>

      <SubmitButton pendingText="Sending…">Send reset link</SubmitButton>
    </form>
  );
}
