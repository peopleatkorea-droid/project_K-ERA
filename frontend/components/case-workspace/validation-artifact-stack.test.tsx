import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ValidationArtifactStack } from "./validation-artifact-stack";

describe("ValidationArtifactStack", () => {
  it("renders branch-aware Grad-CAM previews when dual-input artifacts are present", () => {
    render(
      <ValidationArtifactStack
        locale="en"
        representativePreviewUrl="blob:representative"
        roiCropUrl="blob:roi"
        gradcamUrl="blob:legacy"
        gradcamCorneaUrl="blob:cornea"
        gradcamLesionUrl="blob:lesion"
        medsamMaskUrl={null}
        lesionCropUrl="blob:lesion-crop"
        lesionMaskUrl={null}
      />
    );

    expect(screen.getByText("Cornea Grad-CAM")).toBeInTheDocument();
    expect(screen.getByText("Lesion Grad-CAM")).toBeInTheDocument();
    expect(screen.queryByText(/^Grad-CAM$/)).not.toBeInTheDocument();
  });
});
