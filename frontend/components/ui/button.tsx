import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "ghost" | "primary" | "danger";
type ButtonSize = "sm" | "md";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
};

function joinClassNames(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function Button({
  variant = "ghost",
  size = "md",
  fullWidth = false,
  loading = false,
  leadingIcon,
  trailingIcon,
  className,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      className={joinClassNames("ds-button", className)}
      data-full-width={fullWidth ? "true" : "false"}
      data-size={size}
      data-variant={variant}
      aria-busy={loading ? "true" : undefined}
      disabled={disabled || loading}
    >
      {leadingIcon}
      <span>{children}</span>
      {trailingIcon}
    </button>
  );
}
