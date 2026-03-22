import type { ComponentProps } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SavedCaseImageBoard } from "./saved-case-image-board";

function renderBoard(
  overrides: Partial<ComponentProps<typeof SavedCaseImageBoard>> = {},
) {
  return render(
    <SavedCaseImageBoard
      locale="en"
      commonLoading="Loading..."
      commonNotAvailable="n/a"
      panelBusy={false}
      selectedCaseImageCountHint={0}
      selectedCaseImages={[]}
      liveLesionMaskEnabled={true}
      semanticPromptInputMode="source"
      semanticPromptInputOptions={[{ value: "source", label: "Source" }]}
      semanticPromptBusyImageId={null}
      semanticPromptReviews={{}}
      semanticPromptErrors={{}}
      semanticPromptOpenImageIds={[]}
      liveLesionPreviews={{}}
      savedImageRoiCropUrls={{}}
      savedImageRoiCropBusy={false}
      savedImageLesionCropUrls={{}}
      savedImageLesionCropBusy={false}
      lesionPromptDrafts={{}}
      lesionPromptSaved={{}}
      lesionBoxBusyImageId={null}
      representativeBusyImageId={null}
      pick={(_locale, en) => en}
      translateOption={(_locale, _group, value) => value}
      formatSemanticScore={() => "0.000"}
      onToggleLiveLesionMask={() => undefined}
      onSemanticPromptInputModeChange={() => undefined}
      onSetSavedRepresentative={() => undefined}
      onReviewSemanticPrompts={() => undefined}
      onLesionPointerDown={() => undefined}
      onLesionPointerMove={() => undefined}
      onFinishLesionPointer={() => undefined}
      {...overrides}
    />,
  );
}

describe("SavedCaseImageBoard", () => {
  it("toggles the lesion mask overlay from the header control", () => {
    const handleToggleLiveLesionMask = vi.fn();

    const { rerender } = renderBoard({
      onToggleLiveLesionMask: handleToggleLiveLesionMask,
    });

    expect(
      screen.getByText(
        "Drag a lesion box on the source image. When you release, K-ERA saves the box and starts a live MedSAM mask preview.",
      ),
    ).toBeInTheDocument();

    const enabledToggle = screen.getByRole("button", { name: "MedSAM mask on" });
    expect(enabledToggle).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(enabledToggle);
    expect(handleToggleLiveLesionMask).toHaveBeenCalledTimes(1);

    rerender(
      <SavedCaseImageBoard
        locale="en"
        commonLoading="Loading..."
        commonNotAvailable="n/a"
        panelBusy={false}
        selectedCaseImageCountHint={0}
        selectedCaseImages={[]}
        liveLesionMaskEnabled={false}
        semanticPromptInputMode="source"
        semanticPromptInputOptions={[{ value: "source", label: "Source" }]}
        semanticPromptBusyImageId={null}
        semanticPromptReviews={{}}
        semanticPromptErrors={{}}
        semanticPromptOpenImageIds={[]}
        liveLesionPreviews={{}}
        savedImageRoiCropUrls={{}}
        savedImageRoiCropBusy={false}
        savedImageLesionCropUrls={{}}
        savedImageLesionCropBusy={false}
        lesionPromptDrafts={{}}
        lesionPromptSaved={{}}
        lesionBoxBusyImageId={null}
        representativeBusyImageId={null}
        pick={(_locale, en) => en}
        translateOption={(_locale, _group, value) => value}
        formatSemanticScore={() => "0.000"}
        onToggleLiveLesionMask={handleToggleLiveLesionMask}
        onSemanticPromptInputModeChange={() => undefined}
        onSetSavedRepresentative={() => undefined}
        onReviewSemanticPrompts={() => undefined}
        onLesionPointerDown={() => undefined}
        onLesionPointerMove={() => undefined}
        onFinishLesionPointer={() => undefined}
      />,
    );

    expect(screen.getByRole("button", { name: "MedSAM mask off" })).toHaveAttribute("aria-pressed", "false");
  });

  it("renders the compact Q chip and hides the default View chip when image quality scores are available", () => {
    renderBoard({
      selectedCaseImageCountHint: 1,
      selectedCaseImages: [
        {
          image_id: "image-1",
          visit_id: "visit-1",
          patient_id: "patient-1",
          visit_date: "Initial",
          view: "white",
          image_path: "C:/images/image-1.jpg",
          is_representative: true,
          content_url: "asset://image-1",
          preview_url: "asset://image-1-preview",
          uploaded_at: "2026-03-22T00:00:00Z",
          quality_scores: {
            quality_score: 72.1,
            view_score: 64.4,
          },
        },
      ],
    });

    expect(screen.getByText("Q 72.1")).toBeInTheDocument();
    expect(screen.queryByText("View 64.4")).not.toBeInTheDocument();
    expect(screen.queryByText("Check view")).not.toBeInTheDocument();
  });

  it("shows a small warning chip when the view score is low", () => {
    renderBoard({
      selectedCaseImageCountHint: 1,
      selectedCaseImages: [
        {
          image_id: "image-2",
          visit_id: "visit-2",
          patient_id: "patient-2",
          visit_date: "Initial",
          view: "white",
          image_path: "C:/images/image-2.jpg",
          is_representative: false,
          content_url: "asset://image-2",
          preview_url: "asset://image-2-preview",
          uploaded_at: "2026-03-22T00:00:00Z",
          quality_scores: {
            quality_score: 68.2,
            view_score: 41.5,
          },
        },
      ],
    });

    expect(screen.getByText("Q 68.2")).toBeInTheDocument();
    expect(screen.getByText("Check view")).toBeInTheDocument();
  });

  it("shows lesion crop media and hides the MedSAM overlay in lesion crop mode", () => {
    renderBoard({
      selectedCaseImageCountHint: 1,
      semanticPromptInputMode: "lesion_crop",
      selectedCaseImages: [
        {
          image_id: "image-3",
          visit_id: "visit-3",
          patient_id: "patient-3",
          visit_date: "Initial",
          view: "white",
          image_path: "C:/images/image-3.jpg",
          is_representative: false,
          content_url: "asset://image-3",
          preview_url: "asset://image-3-preview",
          has_lesion_crop: true,
          uploaded_at: "2026-03-22T00:00:00Z",
        },
      ],
      liveLesionPreviews: {
        "image-3": {
          job_id: "job-1",
          status: "done",
          error: null,
          backend: "medsam",
          prompt_signature: "sig-1",
          lesion_mask_url: "asset://image-3-mask",
          lesion_crop_url: "asset://image-3-lesion-crop",
        },
      },
    });

    expect(screen.getByText("Lesion crop mode shows saved lesion crops when available. Return to the source image to draw or edit lesion boxes.")).toBeInTheDocument();
    expect(screen.getByAltText("image-3")).toHaveAttribute("src", "asset://image-3-lesion-crop");
    expect(screen.queryByLabelText("Live MedSAM mask overlay")).not.toBeInTheDocument();
  });

  it("shows ROI crop media and hides the MedSAM overlay in cornea crop mode", () => {
    renderBoard({
      selectedCaseImageCountHint: 1,
      semanticPromptInputMode: "roi_crop",
      selectedCaseImages: [
        {
          image_id: "image-4",
          visit_id: "visit-4",
          patient_id: "patient-4",
          visit_date: "Initial",
          view: "white",
          image_path: "C:/images/image-4.jpg",
          is_representative: false,
          content_url: "asset://image-4",
          preview_url: "asset://image-4-preview",
          has_roi_crop: true,
          uploaded_at: "2026-03-22T00:00:00Z",
        },
      ],
      savedImageRoiCropUrls: {
        "image-4": "asset://image-4-roi-crop",
      },
      liveLesionPreviews: {
        "image-4": {
          job_id: "job-2",
          status: "done",
          error: null,
          backend: "medsam",
          prompt_signature: "sig-2",
          lesion_mask_url: "asset://image-4-mask",
          lesion_crop_url: "asset://image-4-lesion-crop",
        },
      },
    });

    expect(screen.getByText("Cornea crop mode shows saved cornea crops when available. MedSAM overlays stay hidden in crop modes.")).toBeInTheDocument();
    expect(screen.getByAltText("image-4")).toHaveAttribute("src", "asset://image-4-roi-crop");
    expect(screen.queryByLabelText("Live MedSAM mask overlay")).not.toBeInTheDocument();
  });
});
