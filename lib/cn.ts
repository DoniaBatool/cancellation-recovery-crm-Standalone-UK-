/** Join class names, skipping falsy values. (No tailwind-merge: keep overrides additive.) */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
