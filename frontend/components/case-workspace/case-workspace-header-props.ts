"use client";

import type { RefObject } from "react";

import { translateRole, type Locale } from "../../lib/i18n";
import type { DesktopControlPlaneProbe } from "../../lib/desktop-control-plane-status";
import type {
  CaseWorkspaceHeaderAlertsProps,
  CaseWorkspaceHeaderFrameProps,
  CaseWorkspaceHeaderProps,
} from "./case-workspace-header";
import type { CaseWorkspaceToastLogEntry } from "./case-workspace-definitions";

type BuildCaseWorkspaceHeaderFramePropsArgs = {
  locale: Locale;
  title: string;
  subtitle: string;
  theme: "dark" | "light";
  selectedSiteId: string | null;
  controlPlaneStatus?: DesktopControlPlaneProbe | null;
  controlPlaneStatusBusy?: boolean;
  canOpenOperations: boolean;
  userRole: string;
  onToggleTheme: () => void;
  onOpenHospitalAccessRequest?: () => void;
  onOpenOperations: () => void;
  onOpenDesktopSettings?: () => void;
  onExportManifest: () => void;
  onLogout: () => void;
};

type BuildCaseWorkspaceHeaderAlertsPropsArgs = {
  localeTag: string;
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
};

export function buildCaseWorkspaceHeaderFrameProps({
  locale,
  title,
  subtitle,
  theme,
  selectedSiteId,
  controlPlaneStatus,
  controlPlaneStatusBusy = false,
  canOpenOperations,
  userRole,
  onToggleTheme,
  onOpenHospitalAccessRequest,
  onOpenOperations,
  onOpenDesktopSettings,
  onExportManifest,
  onLogout,
}: BuildCaseWorkspaceHeaderFramePropsArgs): CaseWorkspaceHeaderFrameProps {
  return {
    locale,
    title,
    subtitle,
    theme,
    selectedSiteId,
    controlPlaneStatus,
    controlPlaneStatusBusy,
    userRoleLabel: canOpenOperations ? null : translateRole(locale, userRole),
    onToggleTheme,
    onOpenHospitalAccessRequest,
    onOpenOperations: canOpenOperations ? () => onOpenOperations() : undefined,
    onOpenDesktopSettings,
    onExportManifest,
    onLogout,
  };
}

export function buildCaseWorkspaceHeaderAlertsProps({
  localeTag,
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
}: BuildCaseWorkspaceHeaderAlertsPropsArgs): CaseWorkspaceHeaderAlertsProps {
  return {
    localeTag,
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
  };
}

export function buildCaseWorkspaceHeaderProps(
  args: BuildCaseWorkspaceHeaderFramePropsArgs &
    BuildCaseWorkspaceHeaderAlertsPropsArgs,
): CaseWorkspaceHeaderProps {
  return {
    ...buildCaseWorkspaceHeaderFrameProps(args),
    ...buildCaseWorkspaceHeaderAlertsProps(args),
  };
}
