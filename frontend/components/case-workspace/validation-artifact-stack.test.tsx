import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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

  it("stages compact artifact cards so the first review image appears before the rest", () => {
    vi.useFakeTimers();
    try {
      render(
        <ValidationArtifactStack
          locale="en"
          representativePreviewUrl="blob:representative"
          roiCropUrl="blob:roi"
          gradcamUrl="blob:gradcam"
          gradcamCorneaUrl={null}
          gradcamLesionUrl={null}
          medsamMaskUrl={null}
          lesionCropUrl="blob:lesion-crop"
          lesionMaskUrl={null}
          compact
        />,
      );

      expect(screen.getByText("Grad-CAM")).toBeInTheDocument();
      expect(screen.queryByText("Cornea crop")).not.toBeInTheDocument();
      expect(screen.queryByText("Lesion crop")).not.toBeInTheDocument();

      act(() => {
        vi.runAllTimers();
      });

      expect(screen.getByText("Cornea crop")).toBeInTheDocument();
      expect(screen.getByText("Lesion crop")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("stages full artifact cards so the first two review images render before the rest", () => {
    vi.useFakeTimers();
    try {
      render(
        <ValidationArtifactStack
          locale="en"
          representativePreviewUrl="blob:representative"
          roiCropUrl="blob:roi"
          gradcamUrl="blob:gradcam"
          gradcamCorneaUrl={null}
          gradcamLesionUrl={null}
          medsamMaskUrl="blob:medsam-mask"
          lesionCropUrl="blob:lesion-crop"
          lesionMaskUrl="blob:lesion-mask"
        />,
      );

      expect(screen.getByText("Cornea crop")).toBeInTheDocument();
      expect(screen.getByText("Grad-CAM")).toBeInTheDocument();
      expect(screen.queryByText("Cornea mask")).not.toBeInTheDocument();
      expect(screen.queryByText("Lesion crop")).not.toBeInTheDocument();
      expect(screen.queryByText("Lesion mask")).not.toBeInTheDocument();

      act(() => {
        vi.runAllTimers();
      });

      expect(screen.getByText("Cornea mask")).toBeInTheDocument();
      expect(screen.getByText("Lesion crop")).toBeInTheDocument();
      expect(screen.getByText("Lesion mask")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
