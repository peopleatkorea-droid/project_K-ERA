"use client";

import { memo, type ComponentProps } from "react";

import {
  CaseWorkspaceHeaderAlertsControl,
  CaseWorkspaceHeaderFrame,
  type CaseWorkspaceHeaderAlertsProps,
  type CaseWorkspaceHeaderFrameProps,
} from "./case-workspace-header";
import { CaseWorkspaceLeftRail } from "./case-workspace-left-rail";
import {
  CaseWorkspaceMainPrimaryContent,
  CaseWorkspaceSecondaryPanelSlot,
} from "./case-workspace-main-content";
import {
  CaseWorkspaceResearchRegistryModal,
  type CaseWorkspaceResearchRegistryModalProps,
} from "./case-workspace-research-registry-modal";
import {
  CaseWorkspaceShell,
  CaseWorkspaceToastOverlay,
  type CaseWorkspaceToastOverlayProps,
} from "./case-workspace-shell";

export type CaseWorkspaceSurfaceProps = {
  shellProps: Omit<ComponentProps<typeof CaseWorkspaceShell>, "children">;
  toastOverlayProps: CaseWorkspaceToastOverlayProps;
  leftRailProps: ComponentProps<typeof CaseWorkspaceLeftRail>;
  workspaceMainClass: string;
  headerFrameProps: CaseWorkspaceHeaderFrameProps;
  headerAlertsProps: CaseWorkspaceHeaderAlertsProps;
  mainLayoutClass: string;
  mainPrimaryContentProps: ComponentProps<typeof CaseWorkspaceMainPrimaryContent>;
  secondaryPanelProps: ComponentProps<typeof CaseWorkspaceSecondaryPanelSlot>;
  researchRegistryModalProps: CaseWorkspaceResearchRegistryModalProps | null;
};

const CaseWorkspaceSurfaceFrame = memo(function CaseWorkspaceSurfaceFrame({
  leftRailProps,
  workspaceMainClass,
  headerFrameProps,
  headerAlertsProps,
  mainLayoutClass,
  mainPrimaryContentProps,
  secondaryPanelProps,
  researchRegistryModalProps,
}: Omit<CaseWorkspaceSurfaceProps, "shellProps" | "toastOverlayProps">) {
  return (
    <>
      <CaseWorkspaceLeftRail {...leftRailProps} />

      <section className={workspaceMainClass}>
        <CaseWorkspaceHeaderFrame
          {...headerFrameProps}
          alertsControl={
            <CaseWorkspaceHeaderAlertsControl {...headerAlertsProps} />
          }
        />
        <div className={mainLayoutClass}>
          <CaseWorkspaceMainPrimaryContent {...mainPrimaryContentProps} />
          <CaseWorkspaceSecondaryPanelSlot {...secondaryPanelProps} />
        </div>
      </section>

      {researchRegistryModalProps ? (
        <CaseWorkspaceResearchRegistryModal {...researchRegistryModalProps} />
      ) : null}
    </>
  );
});

function CaseWorkspaceSurfaceInner({
  shellProps,
  toastOverlayProps,
  leftRailProps,
  workspaceMainClass,
  headerFrameProps,
  headerAlertsProps,
  mainLayoutClass,
  mainPrimaryContentProps,
  secondaryPanelProps,
  researchRegistryModalProps,
}: CaseWorkspaceSurfaceProps) {
  return (
    <CaseWorkspaceShell {...shellProps}>
      <CaseWorkspaceSurfaceFrame
        leftRailProps={leftRailProps}
        workspaceMainClass={workspaceMainClass}
        headerFrameProps={headerFrameProps}
        headerAlertsProps={headerAlertsProps}
        mainLayoutClass={mainLayoutClass}
        mainPrimaryContentProps={mainPrimaryContentProps}
        secondaryPanelProps={secondaryPanelProps}
        researchRegistryModalProps={researchRegistryModalProps}
      />
      <CaseWorkspaceToastOverlay {...toastOverlayProps} />
    </CaseWorkspaceShell>
  );
}

export const CaseWorkspaceSurface = memo(CaseWorkspaceSurfaceInner);
