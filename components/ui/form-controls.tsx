import * as React from "react";
import { Label as RadixLabel, Switch as RadixSwitch } from "radix-ui";
import { cn } from "@/lib/cn";

const FIELD_BASE =
  "w-full rounded-md border border-input bg-card px-3 text-sm text-foreground " +
  "placeholder:text-muted-foreground transition-colors duration-200 " +
  "disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-destructive";

export function Label({ className, ...props }: React.ComponentProps<typeof RadixLabel.Root>) {
  return <RadixLabel.Root className={cn("text-sm font-medium leading-none text-foreground", className)} {...props} />;
}

export function Input({ className, type = "text", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type={type} className={cn(FIELD_BASE, "h-10", className)} {...props} />;
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(FIELD_BASE, "min-h-24 py-2", className)} {...props} />;
}

/** A native select: reliable on phones and screen readers. */
export function NativeSelect({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(FIELD_BASE, "h-10 pr-8", className)} {...props}>
      {children}
    </select>
  );
}

export function Switch({ className, ...props }: React.ComponentProps<typeof RadixSwitch.Root>) {
  return (
    <RadixSwitch.Root
      className={cn(
        "inline-flex h-6 w-11 shrink-0 items-center rounded-full border border-transparent",
        "transition-colors duration-200 data-[state=checked]:bg-primary data-[state=unchecked]:bg-border",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <RadixSwitch.Thumb className="block h-5 w-5 translate-x-0.5 rounded-full bg-white shadow transition-transform duration-200 data-[state=checked]:translate-x-[22px]" />
    </RadixSwitch.Root>
  );
}

/** Label + control + inline error, wired together for screen readers. */
export function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  /** Receives the aria props to spread onto the control. */
  children: (aria: { id: string; "aria-invalid"?: true; "aria-describedby"?: string }) => React.ReactNode;
}) {
  const describedBy = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(" ");
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        ...(error ? { "aria-invalid": true as const } : {}),
        ...(describedBy ? { "aria-describedby": describedBy } : {}),
      })}
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
