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
        "inline-flex items-center justify-center gap-2 rounded-[12px] border text-sm font-semibold tracking-[-0.01em] shadow-[0_6px_16px_rgba(15,23,42,0.04)] transition duration-150 ease-out focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(48,88,255,0.12)] disabled:pointer-events-none disabled:opacity-60",
        size === "sm" ? "min-h-9 px-3.5" : "min-h-11 px-[18px]",
        fullWidth && "w-full",
        variant === "ghost" &&
          "border-border/80 bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(248,250,252,0.82))] text-ink hover:-translate-y-[1px] hover:border-brand/20 hover:bg-surface-muted",
        variant === "primary" &&
          "border-brand/18 bg-[linear-gradient(135deg,var(--accent),var(--accent-strong))] text-[var(--accent-contrast)] shadow-[0_14px_28px_rgba(48,88,255,0.18)] hover:-translate-y-[1px] hover:border-brand-strong hover:shadow-[0_18px_34px_rgba(48,88,255,0.24)]",
        variant === "danger" &&
          "border-danger/25 bg-danger text-white shadow-[0_12px_24px_rgba(190,24,93,0.16)] hover:-translate-y-[1px] hover:border-danger/50 hover:bg-danger/92",
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
