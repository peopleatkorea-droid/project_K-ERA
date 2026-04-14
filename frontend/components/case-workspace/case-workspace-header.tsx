"use client";

import { type RefObject } from "react";

import { LocaleToggle, pick, type Locale } from "../../lib/i18n";
import { type DesktopControlPlaneProbe } from "../../lib/desktop-control-plane-status";
import type { CaseWorkspaceToastLogEntry } from "./case-workspace-definitions";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { DesktopControlPlaneStatusBadge } from "../ui/desktop-control-plane-status-badge";
import {
  completeIntakeButtonClass,
  docSiteBadgeClass,
  emptySurfaceClass,
  railActivityItemClass,
  railActivityListClass,
  workspaceHeaderClass,
  workspaceKickerClass,
  workspaceTitleCopyClass,
  workspaceTitleRowClass,
  workspaceUserBadgeClass,
} from "../ui/workspace-patterns";

export type CaseWorkspaceHeaderProps = {
  locale: Locale;
  localeTag: string;
  title: string;
  subtitle: string;
  theme: "dark" | "light";
  selectedSiteId: string | null;
  controlPlaneStatus?: DesktopControlPlaneProbe | null;
  controlPlaneStatusBusy?: boolean;
  userRoleLabel: string | null;
  alertsPanelRef: RefObject<HTMLDivElement | null>;
  alertsPanelOpen: boolean;
  alerts: CaseWorkspaceToastLogEntry[];
  recentAlertsLabel: string;
  recentAlertsCopy: string;
  alertsKeptLabel: string;
  clearAlertsLabel: string;
  noAlertsYetLabel: string;
  savedLabel: string;
  actionNeededLabel: string;
  onToggleAlerts: () => void;
  onClearAlerts: () => void;
  onToggleTheme: () => void;
  onOpenHospitalAccessRequest?: () => void;
  onOpenOperations?: () => void;
  onOpenDesktopSettings?: () => void;
  onExportManifest: () => void;
  onLogout: () => void;
};

export function CaseWorkspaceHeader({
  locale,
  localeTag,
  title,
  subtitle,
  theme,
  selectedSiteId,
  controlPlaneStatus,
  controlPlaneStatusBusy = false,
  userRoleLabel,
  alertsPanelRef,
  alertsPanelOpen,
  alerts,
  recentAlertsLabel,
  recentAlertsCopy,
  alertsKeptLabel,
  clearAlertsLabel,
  noAlertsYetLabel,
  savedLabel,
  actionNeededLabel,
  onToggleAlerts,
  onClearAlerts,
  onToggleTheme,
  onOpenHospitalAccessRequest,
  onOpenOperations,
  onOpenDesktopSettings,
  onExportManifest,
  onLogout,
}: CaseWorkspaceHeaderProps) {
  return (
    <header className={workspaceHeaderClass}>
      <div>
        <div className={workspaceKickerClass}>
          {pick(locale, "Research document", "연구 문서")}
        </div>
        <div className={workspaceTitleRowClass}>
          <h2>{title}</h2>
          <span className={workspaceTitleCopyClass}>{subtitle}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-3">
        <DesktopControlPlaneStatusBadge
          locale={locale}
          status={controlPlaneStatus ?? null}
          busy={controlPlaneStatusBusy}
        />
        {userRoleLabel ? (
          <span className={workspaceUserBadgeClass}>{userRoleLabel}</span>
        ) : null}
        <div className="relative" ref={alertsPanelRef}>
          <Button
            type="button"
            variant={alertsPanelOpen ? "primary" : "ghost"}
            aria-haspopup="dialog"
            aria-expanded={alertsPanelOpen}
            onClick={onToggleAlerts}
            trailingIcon={
              alerts.length ? (
                <span
                  aria-hidden="true"
                  className={`inline-flex min-h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[0.72rem] font-semibold ${
                    alertsPanelOpen
                      ? "border border-white/20 bg-white/16 text-[var(--accent-contrast)]"
                      : "border border-border/70 bg-surface text-muted"
                  }`}
                >
                  {alerts.length}
                </span>
              ) : null
            }
          >
            {recentAlertsLabel}
          </Button>
          {alertsPanelOpen ? (
            <Card
              as="section"
              variant="nested"
              role="dialog"
              aria-label={recentAlertsLabel}
              className="absolute right-0 top-full z-40 mt-3 grid w-[min(420px,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] gap-4 border border-border/80 bg-surface p-4 shadow-[0_18px_40px_rgba(15,23,42,0.12)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="grid gap-1">
                  <strong className="text-sm font-semibold text-ink">
                    {recentAlertsLabel}
                  </strong>
                  <p className="m-0 text-sm leading-6 text-muted">
                    {recentAlertsCopy}
                  </p>
                </div>
                <div className="grid gap-2 justify-items-end">
                  <span
                    className={docSiteBadgeClass}
                  >{`${alerts.length} ${alertsKeptLabel}`}</span>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={onClearAlerts}
                    disabled={alerts.length === 0}
                  >
                    {clearAlertsLabel}
                  </Button>
                </div>
              </div>
              {alerts.length ? (
                <div className={railActivityListClass}>
                  {alerts.map((entry) => (
                    <div
                      key={entry.id}
                      className={`${railActivityItemClass} ${
                        entry.tone === "error"
                          ? "border-danger/25 bg-danger/6"
                          : "border-emerald-300/35 bg-emerald-500/6"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <strong>
                          {entry.tone === "success"
                            ? savedLabel
                            : actionNeededLabel}
                        </strong>
                        <span className="text-[0.72rem] text-muted">
                          {new Date(entry.created_at).toLocaleTimeString(
                            localeTag,
                            {
                              hour: "2-digit",
                              minute: "2-digit",
                            },
                          )}
                        </span>
                      </div>
                      <span>{entry.message}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={emptySurfaceClass}>{noAlertsYetLabel}</div>
              )}
            </Card>
          ) : null}
        </div>
        <LocaleToggle />
        <Button variant="ghost" type="button" onClick={onToggleTheme}>
          {theme === "dark"
            ? pick(locale, "Light mode", "라이트 모드")
            : pick(locale, "Dark mode", "다크 모드")}
        </Button>
        {onOpenHospitalAccessRequest ? (
          <Button
            variant="ghost"
            type="button"
            onClick={onOpenHospitalAccessRequest}
          >
            {selectedSiteId
              ? pick(locale, "Request hospital change", "병원 변경 요청")
              : pick(locale, "Request hospital access", "병원 접근 요청")}
          </Button>
        ) : null}
        {onOpenOperations ? (
          <Button variant="ghost" type="button" onClick={onOpenOperations}>
            {pick(locale, "Operations", "운영")}
          </Button>
        ) : null}
        {onOpenDesktopSettings ? (
          <Button variant="ghost" type="button" onClick={onOpenDesktopSettings}>
            {pick(locale, "Desktop settings", "데스크톱 설정")}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          type="button"
          onClick={onExportManifest}
          disabled={!selectedSiteId}
        >
          {pick(locale, "Export manifest", "매니페스트 내보내기")}
        </Button>
        <Button
          className={completeIntakeButtonClass}
          type="button"
          variant="primary"
          onClick={onLogout}
        >
          {pick(locale, "Log out", "로그아웃")}
        </Button>
      </div>
    </header>
  );
}
