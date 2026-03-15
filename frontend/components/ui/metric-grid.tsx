import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "../../lib/cn";

export type MetricGridProps = HTMLAttributes<HTMLDivElement> & {
  columns?: 2 | 3 | 4;
};

export type MetricItemProps = {
  className?: string;
  value: ReactNode;
  label: ReactNode;
};

export function MetricGrid({
  className,
  columns = 2,
  children,
  ...rest
}: MetricGridProps) {
  return (
    <div
      {...rest}
      className={cn(
        "grid gap-3",
        columns === 2 && "grid-cols-2",
        columns === 3 && "grid-cols-3",
        columns === 4 && "grid-cols-4",
        "max-[900px]:grid-cols-1",
        className
      )}
      data-columns={String(columns)}
    >
      {children}
    </div>
  );
}

export function MetricItem({ className, value, label }: MetricItemProps) {
  return (
    <div className={cn("rounded-[18px] border border-border bg-surface-muted/80 p-3.5", className)}>
      <strong className="block text-lg font-semibold tracking-[-0.03em] text-ink">{value}</strong>
      <span className="mt-1 block text-[0.82rem] text-muted">{label}</span>
    </div>
  );
}
