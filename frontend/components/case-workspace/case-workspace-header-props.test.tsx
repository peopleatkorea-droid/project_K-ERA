import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { buildCaseWorkspaceHeaderProps } from "./case-workspace-header-props";

describe("buildCaseWorkspaceHeaderProps", () => {
  it("hides the role badge when operations are available", () => {
    const props = buildCaseWorkspaceHeaderProps({
      locale: "en",
      localeTag: "en-US",
      title: "Case review",
      subtitle: "Review everything",
      theme: "light",
      selectedSiteId: "SITE",
      controlPlaneStatus: null,
      controlPlaneStatusBusy: false,
      canOpenOperations: true,
      userRole: "site_admin",
      alertsPanelRef: createRef<HTMLDivElement>(),
      alertsPanelOpen: false,
      toastHistory: [],
      recentAlertsLabel: "Recent alerts",
      recentAlertsCopy: "Latest activity",
      alertsKeptLabel: "kept",
      clearAlertsLabel: "Clear",
      noAlertsYetLabel: "Nothing yet",
      savedLabel: "Saved",
      actionNeededLabel: "Action needed",
      onToggleAlerts: vi.fn(),
      onClearAlerts: vi.fn(),
      onToggleTheme: vi.fn(),
      onOpenHospitalAccessRequest: vi.fn(),
      onOpenOperations: vi.fn(),
      onOpenDesktopSettings: vi.fn(),
      onExportManifest: vi.fn(),
      onLogout: vi.fn(),
    });

    expect(props.userRoleLabel).toBeNull();
    expect(props.onOpenOperations).toBeTypeOf("function");
  });

  it("shows the translated role badge when operations are unavailable", () => {
    const props = buildCaseWorkspaceHeaderProps({
      locale: "en",
      localeTag: "en-US",
      title: "Case review",
      subtitle: "Review everything",
      theme: "dark",
      selectedSiteId: null,
      controlPlaneStatus: null,
      controlPlaneStatusBusy: true,
      canOpenOperations: false,
      userRole: "researcher",
      alertsPanelRef: createRef<HTMLDivElement>(),
      alertsPanelOpen: true,
      toastHistory: [
        {
          id: "1",
          tone: "success",
          message: "Saved",
          created_at: "2026-04-13T08:00:00Z",
        },
      ],
      recentAlertsLabel: "Recent alerts",
      recentAlertsCopy: "Latest activity",
      alertsKeptLabel: "kept",
      clearAlertsLabel: "Clear",
      noAlertsYetLabel: "Nothing yet",
      savedLabel: "Saved",
      actionNeededLabel: "Action needed",
      onToggleAlerts: vi.fn(),
      onClearAlerts: vi.fn(),
      onToggleTheme: vi.fn(),
      onOpenHospitalAccessRequest: undefined,
      onOpenOperations: vi.fn(),
      onOpenDesktopSettings: undefined,
      onExportManifest: vi.fn(),
      onLogout: vi.fn(),
    });

    expect(props.userRoleLabel).toBe("researcher");
    expect(props.onOpenOperations).toBeUndefined();
    expect(props.alerts).toHaveLength(1);
  });
});
