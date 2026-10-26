"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { Field, Input } from "@/components/ui/form-controls";
import { PasswordInput } from "@/components/ui/password-input";
import { SubmitButton } from "@/components/ui/submit-button";
import { loginAction } from "@/app/(auth)/login/actions";

export function LoginForm({ next, notice }: { next: string; notice?: string }) {
  const [state, formAction] = useActionState(loginAction, null);

  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      {notice ? <Alert tone="info">{notice}</Alert> : null}
      {state?.error ? <Alert tone="error">{state.error}</Alert> : null}

      <Field id="email" label="Email" error={state?.fieldErrors?.email}>
        {(aria) => <Input {...aria} name="email" type="email" autoComplete="email" inputMode="email" required autoFocus />}
      </Field>

      <Field id="password" label="Password" error={state?.fieldErrors?.password}>
        {(aria) => <PasswordInput {...aria} name="password" autoComplete="current-password" required />}
      </Field>

      <SubmitButton pendingText="Signing in…">Sign in</SubmitButton>

      <Link href="/forgot-password" className="text-center text-sm text-link underline-offset-4 hover:underline">
        Forgot your password?
      </Link>
    </form>
  );
}
