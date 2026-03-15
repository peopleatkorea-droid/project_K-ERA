"use client";

import { cn } from "../../lib/cn";
import { useTheme, type Theme } from "../../lib/theme";
import { pick, useI18n } from "../../lib/i18n";

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, setTheme } = useTheme();
  const { locale } = useI18n();

  const options: Array<{ value: Theme; label: string }> = [
    { value: "light", label: pick(locale, "Light", "라이트") },
    { value: "dark", label: pick(locale, "Dark", "다크") },
    { value: "system", label: pick(locale, "System", "시스템") },
  ];

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border bg-surface/80 p-1 shadow-card backdrop-blur-sm",
        className
      )}
      role="radiogroup"
      aria-label={pick(locale, "Theme", "테마")}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={theme === option.value}
          className={cn(
            "inline-flex min-h-9 items-center justify-center rounded-full px-3 text-[0.78rem] font-semibold tracking-[0.02em] transition duration-150 ease-out",
            theme === option.value ? "bg-brand text-[var(--accent-contrast)] shadow-card" : "text-muted hover:text-ink"
          )}
          onClick={() => setTheme(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
