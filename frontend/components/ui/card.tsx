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
          "rounded-[24px] bg-surface shadow-[0_10px_32px_rgba(15,23,42,0.04)]",
        variant === "panel" &&
          "rounded-[24px] bg-surface-elevated shadow-[0_10px_28px_rgba(15,23,42,0.04)]",
        variant === "nested" &&
          "rounded-[18px] bg-surface-muted/55",
        variant === "interactive" &&
          "rounded-[18px] bg-surface-muted/55 transition duration-150 ease-out hover:border-brand/20 hover:bg-[rgba(48,88,255,0.04)]",
        className
      )}
      data-variant={variant}
    >
      {children}
    </Component>
  );
}
