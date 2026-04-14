"use client";

import type { ReactNode } from "react";

import type { Locale } from "../../lib/i18n";
import type { CaseWorkspaceDraftViewProps } from "./case-workspace-main-content";
import type { CaseWorkspaceToastState } from "./case-workspace-definitions";
import type { CaseWorkspaceReviewPanelProps } from "./case-workspace-review-panel";
import type { CaseWorkspaceHeaderProps } from "./case-workspace-header";
import type { CaseWorkspacePatientListViewProps } from "./case-workspace-main-content";
import type { CaseWorkspaceSavedCaseViewProps } from "./case-workspace-main-content";
import type { CaseWorkspaceResearchRegistryModalProps } from "./case-workspace-research-registry-modal";
import type { CaseWorkspaceSurfaceProps } from "./case-workspace-surface";

export function buildCaseWorkspaceSurfaceProps(args: {
  theme: "dark" | "light";
  toast: CaseWorkspaceToastState;
  savedLabel: string;
  actionNeededLabel: string;
  leftRailProps: CaseWorkspaceSurfaceProps["leftRailProps"];
  workspaceMainClass: string;
  headerProps: CaseWorkspaceHeaderProps;
  railView: "cases" | "patients";
  mainLayoutClass: string;
  patientListViewProps: CaseWorkspacePatientListViewProps;
  savedCaseViewProps: CaseWorkspaceSavedCaseViewProps | null;
  analysisSectionContent?: ReactNode;
  selectedSiteId: string | null;
  locale: Locale;
  draftViewProps: CaseWorkspaceDraftViewProps;
  showSecondaryPanel: boolean;
  reviewPanelProps: CaseWorkspaceReviewPanelProps;
  onOpenHospitalAccessRequest?: () => void;
  researchRegistryModalOpen: boolean;
  researchRegistryBusy: boolean;
  researchRegistryExplanationConfirmed: boolean;
  researchRegistryUsageConsented: boolean;
  researchRegistryJoinReady: boolean;
  closeResearchRegistryModal: () => void;
  setResearchRegistryExplanationConfirmed: (value: boolean) => void;
  setResearchRegistryUsageConsented: (value: boolean) => void;
  handleJoinResearchRegistry: () => void | Promise<void>;
}): CaseWorkspaceSurfaceProps {
  const {
    theme,
    toast,
    savedLabel,
    actionNeededLabel,
    leftRailProps,
    workspaceMainClass,
    headerProps,
    railView,
    mainLayoutClass,
    patientListViewProps,
    savedCaseViewProps,
    analysisSectionContent,
    selectedSiteId,
    locale,
    draftViewProps,
    showSecondaryPanel,
    reviewPanelProps,
    onOpenHospitalAccessRequest,
    researchRegistryModalOpen,
    researchRegistryBusy,
    researchRegistryExplanationConfirmed,
    researchRegistryUsageConsented,
    researchRegistryJoinReady,
    closeResearchRegistryModal,
    setResearchRegistryExplanationConfirmed,
    setResearchRegistryUsageConsented,
    handleJoinResearchRegistry,
  } = args;

  const researchRegistryModalProps: CaseWorkspaceResearchRegistryModalProps | null =
    researchRegistryModalOpen
      ? {
          locale,
          busy: researchRegistryBusy,
          explanationConfirmed: researchRegistryExplanationConfirmed,
          usageConsented: researchRegistryUsageConsented,
          joinReady: researchRegistryJoinReady,
          onClose: closeResearchRegistryModal,
          onExplanationConfirmedChange: setResearchRegistryExplanationConfirmed,
          onUsageConsentedChange: setResearchRegistryUsageConsented,
          onJoin: () => void handleJoinResearchRegistry(),
        }
      : null;

  return {
    shellProps: {
      theme,
      toast,
      savedLabel,
      actionNeededLabel,
    },
    leftRailProps,
    workspaceMainClass,
    headerProps,
    mainLayoutProps: {
      railView,
      mainLayoutClass,
      patientListViewProps,
      savedCaseViewProps,
      analysisSectionContent,
      selectedSiteId,
      locale,
      draftViewProps,
      showSecondaryPanel,
      reviewPanelProps,
      onOpenHospitalAccessRequest,
    },
    researchRegistryModalProps,
  };
}
