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
    <div className={cn("min-w-0 rounded-[18px] border border-border bg-surface-muted/80 p-3.5", className)}>
      <strong className="block min-w-0 break-words text-lg font-semibold tracking-[-0.03em] text-ink [overflow-wrap:anywhere]">
        {value}
      </strong>
      <span className="mt-1 block min-w-0 break-words text-[0.82rem] text-muted [overflow-wrap:anywhere]">
        {label}
      </span>
    </div>
  );
}
