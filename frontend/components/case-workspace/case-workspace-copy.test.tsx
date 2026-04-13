import { describe, expect, it } from "vitest";

import { buildCaseWorkspaceCopy } from "./case-workspace-copy";

describe("case-workspace copy helpers", () => {
  it("builds localized copy and formatter helpers for english", () => {
    const copy = buildCaseWorkspaceCopy("en");

    expect(copy.unableLoadPatientList).toBe("Unable to load the patient list.");
    expect(copy.draftUnsaved).toBe("Draft changes live only in this tab");
    expect(copy.caseSaved("P-001", "Initial", "Demo Hospital")).toBe(
      "Case P-001 / Initial saved to Demo Hospital.",
    );
  });

  it("returns localized korean copy for the new AI clinic readiness message", () => {
    const copy = buildCaseWorkspaceCopy("ko");

    expect(copy.aiClinicExpandedReady).toBe(
      "AI Clinic 근거와 workflow가 준비되었습니다.",
    );
    expect(copy.intakeStepRequired).toBe(
      "케이스 저장 전에 intake 섹션을 먼저 완료해 주세요.",
    );
  });
});
