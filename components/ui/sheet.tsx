"use client";

import * as React from "react";
import { Dialog } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.Close;

/** A left-hand drawer, used for the mobile menu. */
export function SheetContent({
  className,
  title,
  children,
}: {
  className?: string;
  /** Required for screen readers; shown as the drawer heading. */
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="animate-overlay-in fixed inset-0 z-40 bg-slate-900/40" />
      <Dialog.Content
        aria-describedby={undefined}
        className={cn(
          "animate-sheet-in-left fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-card shadow-lg",
          className,
        )}
      >
        <div className="flex h-14 items-center justify-between border-b px-4">
          <Dialog.Title className="text-base font-semibold text-primary">{title}</Dialog.Title>
          <Dialog.Close
            aria-label="Close menu"
            className="inline-flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors duration-200 hover:bg-accent"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </Dialog.Close>
        </div>
        {children}
      </Dialog.Content>
    </Dialog.Portal>
  );
}
