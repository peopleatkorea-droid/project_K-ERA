"use client";

export function buildCaseWorkspaceModeState(args: {
  userRole: string;
  railView: "cases" | "patients";
  hasSelectedCase: boolean;
  hasValidationResult: boolean;
}) {
  const { userRole, railView, hasSelectedCase, hasValidationResult } = args;
  const canRunValidation = ["admin", "site_admin", "researcher"].includes(
    userRole,
  );
  const isAuthoringCanvas = railView !== "patients" && !hasSelectedCase;
  return {
    canRunValidation,
    isAuthoringCanvas,
    newCaseModeActive: isAuthoringCanvas,
    listModeActive: railView === "patients" || hasSelectedCase,
    canRunRoiPreview: canRunValidation,
    canRunAiClinic:
      canRunValidation && hasValidationResult && hasSelectedCase,
  };
}
