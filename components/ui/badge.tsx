import * as React from "react";
import { cn } from "@/lib/cn";
import type { Stage, Tone } from "@/lib/constants";
import { STAGE_SHORT_LABELS, STAGE_TONES } from "@/lib/constants";

// Colour is never the only signal: every badge carries text (guide §11).
const TONES: Record<Tone, string> = {
  neutral: "border-border bg-secondary text-muted-foreground",
  info: "border-blue-200 bg-accent text-link",
  warning: "border-amber-300 bg-amber-50 text-amber-800",
  success: "border-green-300 bg-green-50 text-green-800",
  destructive: "border-red-300 bg-red-50 text-red-800",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}

/** Badge for a pipeline stage, with the tone from STAGE_TONES. */
export function StageBadge({ stage, className }: { stage: Stage; className?: string }) {
  return (
    <Badge tone={STAGE_TONES[stage]} className={className}>
      {STAGE_SHORT_LABELS[stage]}
    </Badge>
  );
}
