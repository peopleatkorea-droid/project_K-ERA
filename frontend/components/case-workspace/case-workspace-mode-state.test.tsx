import { describe, expect, it } from "vitest";

import { buildCaseWorkspaceModeState } from "./case-workspace-mode-state";

describe("case-workspace mode state", () => {
  it("enables validation actions for reviewer roles", () => {
    expect(
      buildCaseWorkspaceModeState({
        userRole: "site_admin",
        railView: "cases",
        hasSelectedCase: true,
        hasValidationResult: true,
      }),
    ).toMatchObject({
      canRunValidation: true,
      canRunRoiPreview: true,
      canRunAiClinic: true,
      isAuthoringCanvas: false,
      listModeActive: true,
    });
  });

  it("keeps authoring canvas state separate from patient list mode", () => {
    expect(
      buildCaseWorkspaceModeState({
        userRole: "viewer",
        railView: "cases",
        hasSelectedCase: false,
        hasValidationResult: false,
      }),
    ).toMatchObject({
      canRunValidation: false,
      canRunRoiPreview: false,
      canRunAiClinic: false,
      isAuthoringCanvas: true,
      newCaseModeActive: true,
      listModeActive: false,
    });
  });
});
