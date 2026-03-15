import type { ReactNode } from "react";

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

function joinClassNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

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
  return (
    <Component className={joinClassNames("ds-field", className)} {...(Component === "label" ? { htmlFor } : {})}>
      {label ? <span className="ds-field__label">{label}</span> : null}
      <div className="ds-field__control">{children}</div>
      {hint ? <div className="ds-field__hint">{hint}</div> : null}
      {error ? <div className="ds-field__error">{error}</div> : null}
    </Component>
  );
}
