import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SavedCaseImageBoard } from "./saved-case-image-board";

describe("SavedCaseImageBoard", () => {
  it("toggles the lesion mask overlay from the header control", () => {
    const handleToggleLiveLesionMask = vi.fn();

    const { rerender } = render(
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

    expect(
      screen.getByText(
        "Drag a lesion box on the image. When you release, K-ERA saves the box and starts a live MedSAM mask preview.",
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
    render(
      <SavedCaseImageBoard
        locale="en"
        commonLoading="Loading..."
        commonNotAvailable="n/a"
        panelBusy={false}
        selectedCaseImageCountHint={1}
        selectedCaseImages={[
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
        ]}
        liveLesionMaskEnabled={true}
        semanticPromptInputMode="source"
        semanticPromptInputOptions={[{ value: "source", label: "Source" }]}
        semanticPromptBusyImageId={null}
        semanticPromptReviews={{}}
        semanticPromptErrors={{}}
        semanticPromptOpenImageIds={[]}
        liveLesionPreviews={{}}
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
      />,
    );

    expect(screen.getByText("Q 72.1")).toBeInTheDocument();
    expect(screen.queryByText("View 64.4")).not.toBeInTheDocument();
    expect(screen.queryByText("Check view")).not.toBeInTheDocument();
  });

  it("shows a small warning chip when the view score is low", () => {
    render(
      <SavedCaseImageBoard
        locale="en"
        commonLoading="Loading..."
        commonNotAvailable="n/a"
        panelBusy={false}
        selectedCaseImageCountHint={1}
        selectedCaseImages={[
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
        ]}
        liveLesionMaskEnabled={true}
        semanticPromptInputMode="source"
        semanticPromptInputOptions={[{ value: "source", label: "Source" }]}
        semanticPromptBusyImageId={null}
        semanticPromptReviews={{}}
        semanticPromptErrors={{}}
        semanticPromptOpenImageIds={[]}
        liveLesionPreviews={{}}
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
      />,
    );

    expect(screen.getByText("Q 68.2")).toBeInTheDocument();
    expect(screen.getByText("Check view")).toBeInTheDocument();
  });
});
