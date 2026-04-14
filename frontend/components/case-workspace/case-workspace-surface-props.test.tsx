import { describe, expect, it, vi } from "vitest";

import { buildCaseWorkspaceSurfaceProps } from "./case-workspace-surface-props";

describe("case-workspace surface props", () => {
  it("omits the research registry modal when closed", () => {
    const props = buildCaseWorkspaceSurfaceProps({
      theme: "light",
      toast: null,
      savedLabel: "Saved",
      actionNeededLabel: "Action needed",
      leftRailProps: {} as any,
      workspaceMainClass: "workspace-main",
      headerProps: {} as any,
      railView: "patients",
      mainLayoutClass: "layout",
      patientListViewProps: {} as any,
      savedCaseViewProps: null,
      analysisSectionContent: null,
      selectedSiteId: null,
      locale: "en",
      draftViewProps: {} as any,
      showSecondaryPanel: false,
      reviewPanelProps: {} as any,
      researchRegistryModalOpen: false,
      researchRegistryBusy: false,
      researchRegistryExplanationConfirmed: false,
      researchRegistryUsageConsented: false,
      researchRegistryJoinReady: false,
      closeResearchRegistryModal: vi.fn(),
      setResearchRegistryExplanationConfirmed: vi.fn(),
      setResearchRegistryUsageConsented: vi.fn(),
      handleJoinResearchRegistry: vi.fn(),
    });

    expect(props.researchRegistryModalProps).toBeNull();
    expect(props.shellProps).toMatchObject({
      theme: "light",
      savedLabel: "Saved",
      actionNeededLabel: "Action needed",
    });
  });

  it("wraps the research registry join action when the modal is open", () => {
    const handleJoinResearchRegistry = vi.fn();
    const props = buildCaseWorkspaceSurfaceProps({
      theme: "dark",
      toast: { tone: "success", message: "ok" },
      savedLabel: "Saved",
      actionNeededLabel: "Action needed",
      leftRailProps: {} as any,
      workspaceMainClass: "workspace-main",
      headerProps: {} as any,
      railView: "cases",
      mainLayoutClass: "layout",
      patientListViewProps: {} as any,
      savedCaseViewProps: {} as any,
      analysisSectionContent: null,
      selectedSiteId: "site-1",
      locale: "ko",
      draftViewProps: {} as any,
      showSecondaryPanel: true,
      reviewPanelProps: {} as any,
      researchRegistryModalOpen: true,
      researchRegistryBusy: true,
      researchRegistryExplanationConfirmed: true,
      researchRegistryUsageConsented: true,
      researchRegistryJoinReady: true,
      closeResearchRegistryModal: vi.fn(),
      setResearchRegistryExplanationConfirmed: vi.fn(),
      setResearchRegistryUsageConsented: vi.fn(),
      handleJoinResearchRegistry,
    });

    expect(props.researchRegistryModalProps).not.toBeNull();
    props.researchRegistryModalProps?.onJoin();
    expect(handleJoinResearchRegistry).toHaveBeenCalledOnce();
  });
});
