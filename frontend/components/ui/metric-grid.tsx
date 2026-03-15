import type { HTMLAttributes, ReactNode } from "react";

export type MetricGridProps = HTMLAttributes<HTMLDivElement> & {
  columns?: 2 | 3 | 4;
};

export type MetricItemProps = {
  className?: string;
  value: ReactNode;
  label: ReactNode;
};

function joinClassNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function MetricGrid({
  className,
  columns = 2,
  children,
  ...rest
}: MetricGridProps) {
  return (
    <div {...rest} className={joinClassNames("ds-metric-grid", className)} data-columns={String(columns)}>
      {children}
    </div>
  );
}

export function MetricItem({ className, value, label }: MetricItemProps) {
  return (
    <div className={joinClassNames("ds-metric-item", className)}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
