"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Toggle chips that post as a repeated checkbox field (`name=value` once per ticked chip).
 * Real checkboxes keep it keyboard and screen-reader friendly; the tick icon means colour
 * is not the only signal.
 */
export function ChoiceChips({
  name,
  options,
  defaultValue = [],
  legend,
  large = false,
  className,
}: {
  name: string;
  options: readonly { value: string; label: string }[];
  defaultValue?: readonly string[];
  legend: string;
  /** 44 px tall chips for patient-facing pages. */
  large?: boolean;
  className?: string;
}) {
  return (
    <fieldset className={cn("flex flex-col gap-1.5", className)}>
      <legend className="mb-1.5 text-sm font-medium text-foreground">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label key={option.value} className="cursor-pointer">
            <input
              type="checkbox"
              name={name}
              value={option.value}
              defaultChecked={defaultValue.includes(option.value)}
              className="peer sr-only"
            />
            <span
              className={cn(
                large ? "h-11" : "h-9",
                "inline-flex items-center gap-1 rounded-full border border-input bg-card px-3 text-sm text-foreground",
                "transition-colors duration-200 hover:bg-accent",
                "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring",
                "peer-checked:border-primary peer-checked:bg-accent peer-checked:font-medium peer-checked:text-link",
                "peer-checked:before:content-['✓']",
              )}
            >
              {option.label}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
