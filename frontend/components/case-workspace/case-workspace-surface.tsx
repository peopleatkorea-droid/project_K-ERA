"use client";

import type { ComponentProps } from "react";

import { CaseWorkspaceHeader, type CaseWorkspaceHeaderProps } from "./case-workspace-header";
import { CaseWorkspaceLeftRail } from "./case-workspace-left-rail";
import { CaseWorkspaceMainLayout } from "./case-workspace-main-content";
import {
  CaseWorkspaceResearchRegistryModal,
  type CaseWorkspaceResearchRegistryModalProps,
} from "./case-workspace-research-registry-modal";
import { CaseWorkspaceShell } from "./case-workspace-shell";

export type CaseWorkspaceSurfaceProps = {
  shellProps: Omit<ComponentProps<typeof CaseWorkspaceShell>, "children">;
  leftRailProps: ComponentProps<typeof CaseWorkspaceLeftRail>;
  workspaceMainClass: string;
  headerProps: CaseWorkspaceHeaderProps;
  mainLayoutProps: ComponentProps<typeof CaseWorkspaceMainLayout>;
  researchRegistryModalProps: CaseWorkspaceResearchRegistryModalProps | null;
};

export function CaseWorkspaceSurface({
  shellProps,
  leftRailProps,
  workspaceMainClass,
  headerProps,
  mainLayoutProps,
  researchRegistryModalProps,
}: CaseWorkspaceSurfaceProps) {
  return (
    <CaseWorkspaceShell {...shellProps}>
      <CaseWorkspaceLeftRail {...leftRailProps} />

      <section className={workspaceMainClass}>
        <CaseWorkspaceHeader {...headerProps} />
        <CaseWorkspaceMainLayout {...mainLayoutProps} />
      </section>

      {researchRegistryModalProps ? (
        <CaseWorkspaceResearchRegistryModal {...researchRegistryModalProps} />
      ) : null}
    </CaseWorkspaceShell>
  );
}
