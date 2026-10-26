"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Field } from "@/components/ui/form-controls";
import { PasswordInput } from "@/components/ui/password-input";
import { SubmitButton } from "@/components/ui/submit-button";
import { setPasswordAction } from "@/app/(auth)/set-password/actions";
import { PASSWORD_MAX, PASSWORD_MIN } from "@/lib/validation";

export function SetPasswordForm() {
  const [state, formAction] = useActionState(setPasswordAction, null);

  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}

      <Field
        id="password"
        label="New password"
        hint={`${PASSWORD_MIN}–${PASSWORD_MAX} characters.`}
        error={state?.fieldErrors?.password}
      >
        {(aria) => (
          <PasswordInput
            {...aria}
            name="password"
            autoComplete="new-password"
            minLength={PASSWORD_MIN}
            maxLength={PASSWORD_MAX}
            required
            autoFocus
          />
        )}
      </Field>

      <Field id="confirm" label="Confirm new password" error={state?.fieldErrors?.confirm}>
        {(aria) => <PasswordInput {...aria} name="confirm" autoComplete="new-password" required />}
      </Field>

      <SubmitButton pendingText="Saving…">Save password</SubmitButton>
    </form>
  );
}
