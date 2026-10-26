import * as React from "react";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/cn";

type AlertTone = "error" | "success" | "info";

const STYLES: Record<AlertTone, string> = {
  error: "border-red-300 bg-red-50 text-red-900",
  success: "border-green-300 bg-green-50 text-green-900",
  info: "border-blue-200 bg-accent text-accent-foreground",
};

const ICONS = { error: AlertCircle, success: CheckCircle2, info: Info } as const;

/** Icon + text, so colour is never the only signal. Errors are announced to screen readers. */
export function Alert({
  tone = "info",
  className,
  children,
}: {
  tone?: AlertTone;
  className?: string;
  children: React.ReactNode;
}) {
  const Icon = ICONS[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("flex gap-2 rounded-md border p-3 text-sm", STYLES[tone], className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}
