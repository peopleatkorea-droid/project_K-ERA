import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "../../lib/cn";

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
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full border text-sm font-semibold tracking-[-0.01em] transition duration-150 ease-out focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(48,88,255,0.12)] disabled:pointer-events-none disabled:opacity-60",
        size === "sm" ? "min-h-9 px-3.5" : "min-h-11 px-[18px]",
        fullWidth && "w-full",
        variant === "ghost" &&
          "border-border bg-white/50 text-ink shadow-card hover:-translate-y-0.5 hover:border-brand/20 hover:bg-surface-muted dark:bg-white/4",
        variant === "primary" &&
          "border-brand/20 bg-linear-to-b from-brand to-brand-strong text-[var(--accent-contrast)] shadow-[0_14px_28px_rgba(48,88,255,0.18)] hover:-translate-y-0.5 hover:shadow-[0_18px_34px_rgba(48,88,255,0.22)]",
        variant === "danger" &&
          "border-danger/25 bg-linear-to-b from-danger/90 to-danger text-white shadow-[0_14px_28px_rgba(212,93,99,0.22)] hover:-translate-y-0.5",
        className
      )}
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
