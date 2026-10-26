import * as React from "react";
import { Slot } from "radix-ui";
import { cn } from "@/lib/cn";

export type ButtonVariant = "default" | "secondary" | "outline" | "ghost" | "destructive" | "link";
export type ButtonSize = "default" | "sm" | "lg" | "icon";

const VARIANTS: Record<ButtonVariant, string> = {
  default: "bg-primary text-primary-foreground hover:bg-primary/90",
  secondary: "bg-secondary text-secondary-foreground hover:bg-border",
  outline: "border border-input bg-card text-foreground hover:bg-accent",
  ghost: "text-foreground hover:bg-accent",
  destructive: "bg-destructive text-white hover:bg-destructive/90",
  link: "text-link underline-offset-4 hover:underline",
};

const SIZES: Record<ButtonSize, string> = {
  default: "h-10 px-4 text-sm",
  sm: "h-9 px-3 text-sm",
  // 44 px: the minimum tap target for patient pages (guide §11).
  lg: "h-11 px-6 text-base",
  icon: "h-10 w-10",
};

export function buttonClasses(variant: ButtonVariant = "default", size: ButtonSize = "default", className?: string) {
  return cn(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium",
    "transition-colors duration-200 ease-out-soft",
    "disabled:pointer-events-none disabled:opacity-50",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Render the child element (for example a Link) with button styles. */
  asChild?: boolean;
};

export function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      className={buttonClasses(variant, size, className)}
      {...(asChild ? {} : { type: type ?? "button" })}
      {...props}
    />
  );
}
