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

    const enabledToggle = screen.getByRole("button", { name: "Lesion mask on" });
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

    expect(screen.getByRole("button", { name: "Lesion mask off" })).toHaveAttribute("aria-pressed", "false");
  });
});
