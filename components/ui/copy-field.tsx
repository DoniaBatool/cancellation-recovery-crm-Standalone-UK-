"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

/** A read-only value with a Copy button. */
export function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be blocked; the text stays selectable in the field.
    }
  }

  return (
    <div className="flex items-center gap-2">
      <input
        readOnly
        aria-label={label}
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        className="h-10 min-w-0 flex-1 rounded-md border border-input bg-secondary px-3 text-sm text-foreground"
      />
      <Button type="button" variant="outline" onClick={copy} aria-live="polite">
        {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}
