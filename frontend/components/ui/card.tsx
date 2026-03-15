import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "../../lib/cn";

type CardVariant = "surface" | "panel" | "nested" | "interactive";
type CardElement = "div" | "section" | "article";

export type CardProps = HTMLAttributes<HTMLElement> & {
  as?: CardElement;
  variant?: CardVariant;
  children: ReactNode;
};

export function Card({
  as = "section",
  variant = "surface",
  className,
  children,
  ...rest
}: CardProps) {
  const Component = as;
  return (
    <Component
      {...rest}
      className={cn(
        "border border-border text-ink",
        variant === "surface" &&
          "rounded-[var(--radius-lg)] bg-surface/90 shadow-panel backdrop-blur-xl",
        variant === "panel" &&
          "rounded-[var(--radius-lg)] bg-surface-elevated/95 shadow-panel backdrop-blur-xl",
        variant === "nested" &&
          "rounded-[20px] bg-surface-muted/80",
        variant === "interactive" &&
          "rounded-[20px] bg-surface-muted/80 transition duration-150 ease-out hover:-translate-y-0.5 hover:border-brand/20 hover:bg-brand-soft/70",
        className
      )}
      data-variant={variant}
    >
      {children}
    </Component>
  );
}
