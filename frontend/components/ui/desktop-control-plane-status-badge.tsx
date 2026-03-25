"use client";

import { pick, type Locale } from "../../lib/i18n";
import { type DesktopControlPlaneProbe } from "../../lib/desktop-control-plane-status";

type DesktopControlPlaneStatusBadgeProps = {
  locale: Locale;
  status: DesktopControlPlaneProbe | null;
  busy?: boolean;
};

export function DesktopControlPlaneStatusBadge({
  locale,
  status,
  busy = false,
}: DesktopControlPlaneStatusBadgeProps) {
  let label = pick(locale, "Control plane", "운영 허브");
  let badgeClass = "border-border/80 bg-surface text-muted";

  if (busy && !status) {
    label = pick(locale, "Control plane checking", "운영 허브 확인 중");
  } else if (status?.state === "ready") {
    label = pick(locale, "Control plane connected", "운영 허브 연결됨");
    badgeClass = "border-emerald-300/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  } else if (status?.state === "not_configured") {
    label = pick(locale, "Control plane setup needed", "운영 허브 설정 필요");
    badgeClass = "border-amber-300/50 bg-amber-500/10 text-amber-800 dark:text-amber-300";
  } else if (status?.state === "unavailable") {
    label = pick(locale, "Control plane unavailable", "운영 허브 연결 불가");
    badgeClass = "border-amber-300/50 bg-amber-500/10 text-amber-800 dark:text-amber-300";
  } else if (status?.state === "error") {
    label = pick(locale, "Control plane check failed", "운영 허브 확인 실패");
    badgeClass = "border-danger/25 bg-danger/10 text-danger";
  }

  const titleParts = [label];
  if (status?.detail) {
    titleParts.push(status.detail);
  }
  if (status?.baseUrl) {
    titleParts.push(status.baseUrl);
  }

  return (
    <span
      title={titleParts.join("\n")}
      className={`inline-flex min-h-9 items-center rounded-full border px-3 text-[0.76rem] font-semibold tracking-[0.02em] ${badgeClass}`}
    >
      {label}
    </span>
  );
}
