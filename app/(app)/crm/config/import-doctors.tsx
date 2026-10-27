"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/ui/submit-button";
import { importDentallyDoctors } from "./actions";

/** Button on Settings: add the dentists from Dentally. Only shown when Dentally is connected. */
export function ImportDoctors() {
  const [state, action] = useActionState(importDentallyDoctors, null);
  return (
    <form action={action} className="flex flex-col gap-2">
      <SubmitButton variant="outline" pendingText="Reading Dentally…">
        Import dentists from Dentally
      </SubmitButton>
      {state?.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : state?.message ? (
        <p role="status" className="text-sm text-muted-foreground">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
