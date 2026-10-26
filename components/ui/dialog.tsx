"use client";

import * as React from "react";
import { Dialog as RadixDialog } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

/** A centred modal. `title` is required for screen readers and shown as the heading. */
export function DialogContent({
  title,
  description,
  className,
  children,
}: {
  title: string;
  description?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="animate-overlay-in fixed inset-0 z-40 bg-slate-900/40" />
      <RadixDialog.Content
        {...(description ? {} : { "aria-describedby": undefined })}
        className={cn(
          "animate-dialog-in fixed left-1/2 top-1/2 z-50 flex max-h-[90dvh] w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border bg-card shadow-lg",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b px-5 py-4">
          <div>
            <RadixDialog.Title className="text-base font-semibold text-foreground">{title}</RadixDialog.Title>
            {description ? (
              <RadixDialog.Description className="mt-1 text-sm text-muted-foreground">{description}</RadixDialog.Description>
            ) : null}
          </div>
          <RadixDialog.Close
            aria-label="Close"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors duration-200 hover:bg-accent"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </RadixDialog.Close>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}
