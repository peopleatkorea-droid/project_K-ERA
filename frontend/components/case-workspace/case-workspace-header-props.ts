"use client";

import type { RefObject } from "react";

import { translateRole, type Locale } from "../../lib/i18n";
import type { DesktopControlPlaneProbe } from "../../lib/desktop-control-plane-status";
import type { CaseWorkspaceHeaderProps } from "./case-workspace-header";
import type { CaseWorkspaceToastLogEntry } from "./case-workspace-definitions";

type BuildCaseWorkspaceHeaderPropsArgs = {
  locale: Locale;
  localeTag: string;
  title: string;
  subtitle: string;
  theme: "dark" | "light";
  selectedSiteId: string | null;
  controlPlaneStatus?: DesktopControlPlaneProbe | null;
  controlPlaneStatusBusy?: boolean;
  canOpenOperations: boolean;
  userRole: string;
  alertsPanelRef: RefObject<HTMLDivElement | null>;
  alertsPanelOpen: boolean;
  toastHistory: CaseWorkspaceToastLogEntry[];
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
  onOpenOperations: () => void;
  onOpenDesktopSettings?: () => void;
  onExportManifest: () => void;
  onLogout: () => void;
};

export function buildCaseWorkspaceHeaderProps({
  locale,
  localeTag,
  title,
  subtitle,
  theme,
  selectedSiteId,
  controlPlaneStatus,
  controlPlaneStatusBusy = false,
  canOpenOperations,
  userRole,
  alertsPanelRef,
  alertsPanelOpen,
  toastHistory,
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
}: BuildCaseWorkspaceHeaderPropsArgs): CaseWorkspaceHeaderProps {
  return {
    locale,
    localeTag,
    title,
    subtitle,
    theme,
    selectedSiteId,
    controlPlaneStatus,
    controlPlaneStatusBusy,
    userRoleLabel: canOpenOperations ? null : translateRole(locale, userRole),
    alertsPanelRef,
    alertsPanelOpen,
    alerts: toastHistory,
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
    onOpenOperations: canOpenOperations ? () => onOpenOperations() : undefined,
    onOpenDesktopSettings,
    onExportManifest,
    onLogout,
  };
}
