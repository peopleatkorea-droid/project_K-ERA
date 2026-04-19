import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SavedCasePreviewPanels } from "./saved-case-preview-panels";

describe("SavedCasePreviewPanels", () => {
  it("stages saved preview cards so the first preview renders before the rest", () => {
    vi.useFakeTimers();
    try {
      render(
        <SavedCasePreviewPanels
          locale="en"
          commonLoading="Loading..."
          canRunRoiPreview
          selectedCaseImageCount={3}
          hasAnySavedLesionBox
          roiPreviewBusy={false}
          lesionPreviewBusy={false}
          roiPreviewItems={[
            {
              image_id: "image_1",
              source_image_path: "source_1",
              view: "white",
              is_representative: true,
              backend: "medsam",
              source_preview_url: "/preview/source_1",
              medsam_mask_url: null,
              roi_crop_url: "/preview/roi_1",
            },
            {
              image_id: "image_2",
              source_image_path: "source_2",
              view: "fluorescein",
              is_representative: false,
              backend: "medsam",
              source_preview_url: "/preview/source_2",
              medsam_mask_url: null,
              roi_crop_url: "/preview/roi_2",
            },
            {
              image_id: "image_3",
              source_image_path: "source_3",
              view: "white",
              is_representative: false,
              backend: "medsam",
              source_preview_url: "/preview/source_3",
              medsam_mask_url: null,
              roi_crop_url: "/preview/roi_3",
            },
          ] as any}
          lesionPreviewItems={[]}
          pick={(locale, en, ko) => (locale === "ko" ? ko : en)}
          translateOption={(_locale, _group, value) => value}
          onRunRoiPreview={vi.fn()}
          onRunLesionPreview={vi.fn()}
        />,
      );

      expect(screen.getByAltText("white source")).toBeInTheDocument();
      expect(screen.queryByAltText("fluorescein source")).not.toBeInTheDocument();

      act(() => {
        vi.runAllTimers();
      });

      expect(screen.getByAltText("fluorescein source")).toBeInTheDocument();
      expect(screen.getAllByAltText("white source")).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
