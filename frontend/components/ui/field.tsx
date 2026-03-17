import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

import { cn } from "../../lib/cn";

type FieldElement = "label" | "div";

export type FieldProps = {
  as?: FieldElement;
  className?: string;
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
};

export function Field({
  as = "label",
  className,
  label,
  hint,
  error,
  htmlFor,
  children,
}: FieldProps) {
  const Component = as;
  const controlClassName =
    "min-h-12 w-full rounded-[14px] border border-border/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(248,250,252,0.88))] px-3.5 py-2.5 text-sm text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_6px_16px_rgba(15,23,42,0.03)] outline-none transition duration-150 ease-out placeholder:text-muted focus:border-brand/25 focus:ring-4 focus:ring-[rgba(48,88,255,0.12)] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white/4";
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<{ className?: string }>, {
        className: cn(controlClassName, (children.props as { className?: string }).className),
      })
    : children;

  return (
    <Component
      className={cn("grid gap-2.5", className)}
      {...(Component === "label" ? { htmlFor } : {})}
    >
      {label ? <span className="text-[0.82rem] font-medium text-muted">{label}</span> : null}
      <div className="min-w-0">{control}</div>
      {hint ? <div className="text-[0.76rem] leading-6 text-muted">{hint}</div> : null}
      {error ? <div className="text-[0.76rem] leading-6 text-danger">{error}</div> : null}
    </Component>
  );
}
