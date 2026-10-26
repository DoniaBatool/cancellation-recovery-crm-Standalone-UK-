import Link from "next/link";
import { cn } from "@/lib/cn";
import { RANGES, RANGE_LABELS, type Range } from "@/lib/constants";

/** Week / Month / Quarter switch. Plain links (?range=...), so it works without JavaScript. */
export function RangeTabs({ current, basePath }: { current: Range; basePath: string }) {
  return (
    <nav aria-label="Time range" className="inline-flex rounded-md border bg-card p-1">
      {RANGES.map((range) => {
        const active = range === current;
        return (
          <Link
            key={range}
            href={`${basePath}?range=${range}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex h-8 items-center rounded-sm px-3 text-sm font-medium transition-colors duration-200",
              active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {RANGE_LABELS[range]}
          </Link>
        );
      })}
    </nav>
  );
}
