import type { HTMLAttributes, ReactNode } from "react";

type CardVariant = "surface" | "panel" | "nested" | "interactive";
type CardElement = "div" | "section" | "article";

export type CardProps = HTMLAttributes<HTMLElement> & {
  as?: CardElement;
  variant?: CardVariant;
  children: ReactNode;
};

function joinClassNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function Card({
  as = "section",
  variant = "surface",
  className,
  children,
  ...rest
}: CardProps) {
  const Component = as;
  return (
    <Component {...rest} className={joinClassNames("ds-card", className)} data-variant={variant}>
      {children}
    </Component>
  );
}
