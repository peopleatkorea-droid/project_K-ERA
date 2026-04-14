import { describe, expect, it, vi } from "vitest";

import {
  resolveSavedImageLesionCropArtifacts,
  resolveSavedImageRoiCropArtifacts,
} from "./case-workspace-preview-artifact-runtime";

describe("case-workspace preview artifact runtime", () => {
  it("resolves saved roi crop urls from stored preview artifacts", async () => {
    const api = await import("../../lib/api");
    const roiPreviewSpy = vi
      .spyOn(api, "fetchCaseRoiPreview")
      .mockResolvedValue([{ image_id: "image_1", has_roi_crop: true }] as any);
    const roiArtifactSpy = vi
      .spyOn(api, "fetchCaseRoiPreviewArtifactUrl")
      .mockImplementation(
        async (_siteId, _patientId, _visitDate, imageId) => `/roi/${imageId}`,
      );

    try {
      const result = await resolveSavedImageRoiCropArtifacts({
        siteId: "site-1",
        patientId: "P-001",
        visitDate: "Initial",
        token: "token",
        images: [{ image_id: "image_1" }] as any,
        currentUrls: {},
      });

      expect(roiPreviewSpy).toHaveBeenCalledOnce();
      expect(roiArtifactSpy).toHaveBeenCalledWith(
        "site-1",
        "P-001",
        "Initial",
        "image_1",
        "roi_crop",
        "token",
      );
      expect(result.entries).toEqual([["image_1", "/roi/image_1"]]);
      expect(result.urls).toEqual(["/roi/image_1"]);
    } finally {
      roiPreviewSpy.mockRestore();
      roiArtifactSpy.mockRestore();
    }
  });

  it("uses saved image lesion flags when no stored lesion box exists", async () => {
    const api = await import("../../lib/api");
    const lesionPreviewSpy = vi
      .spyOn(api, "fetchCaseLesionPreview")
      .mockResolvedValue([]);
    const lesionArtifactSpy = vi
      .spyOn(api, "fetchCaseLesionPreviewArtifactUrl")
      .mockImplementation(
        async (_siteId, _patientId, _visitDate, imageId) =>
          `/lesion/${imageId}`,
      );

    try {
      const result = await resolveSavedImageLesionCropArtifacts({
        siteId: "site-1",
        patientId: "P-001",
        visitDate: "Initial",
        token: "token",
        images: [{ image_id: "image_1", has_lesion_crop: true }] as any,
        liveLesionPreviews: {} as any,
        currentUrls: {},
      });

      expect(lesionPreviewSpy).not.toHaveBeenCalled();
      expect(lesionArtifactSpy).toHaveBeenCalledWith(
        "site-1",
        "P-001",
        "Initial",
        "image_1",
        "lesion_crop",
        "token",
      );
      expect(result.entries).toEqual([["image_1", "/lesion/image_1"]]);
      expect(result.urls).toEqual(["/lesion/image_1"]);
    } finally {
      lesionPreviewSpy.mockRestore();
      lesionArtifactSpy.mockRestore();
    }
  });
});
