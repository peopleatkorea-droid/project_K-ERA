import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AiClinicPanel } from "./ai-clinic-panel";

describe("AiClinicPanel", () => {
  it("renders clinician-friendly labels in clinical mode", () => {
    render(
      <AiClinicPanel
        locale="en"
        clinicalMode
        showStepActions
        validationResult={{} as any}
        activeView="retrieval"
        aiClinicBusy={false}
        aiClinicExpandedBusy={false}
        canRunAiClinic
        canExpandAiClinic
        onRunAiClinic={vi.fn(async () => null)}
        onExpandAiClinic={vi.fn()}
        onSelectRetrievalView={vi.fn()}
        onSelectClusterView={vi.fn()}
      >
        <div>child</div>
      </AiClinicPanel>,
    );

    expect(screen.getByText("Similar cases and 3D map")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show similar cases" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load more explanation" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Similar cases" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "3D map" })).toBeInTheDocument();
  });
});
