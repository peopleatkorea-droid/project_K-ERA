import { describe, expect, it } from "vitest";

import {
  applyLesionPreviewFlags,
  applyRoiPreviewFlags,
  buildLesionPreviewCards,
  buildPreviewByImageId,
  buildRoiPreviewCards,
  collectResolvedPreviewUrls,
  mergeResolvedPreviewUrls,
  resolvePreviewArtifactEntries,
  selectUnresolvedLesionCropImages,
  selectUnresolvedRoiCropImages,
} from "./case-workspace-preview-artifact-helpers";

describe("case-workspace preview artifact helpers", () => {
  it("selects unresolved saved crop images", () => {
    const images = [
      { image_id: "image_1" },
      { image_id: "image_2" },
    ] as any[];

    expect(
      selectUnresolvedRoiCropImages(images as any, { image_1: "/roi/1" }).map(
        (image) => image.image_id,
      ),
    ).toEqual(["image_2"]);

    expect(
      selectUnresolvedLesionCropImages(
        images as any,
        { image_1: { lesion_crop_url: "/lesion/1" } } as any,
        {},
      ).map((image) => image.image_id),
    ).toEqual(["image_2"]);
  });

  it("applies preview flags and merges resolved entries", async () => {
    const images = [
      { image_id: "image_1", has_roi_crop: false, has_medsam_mask: false },
      { image_id: "image_2", has_lesion_crop: false, has_lesion_mask: false },
    ] as any[];
    const roiMap = buildPreviewByImageId([
      { image_id: "image_1", has_roi_crop: true, has_medsam_mask: true },
    ]);
    const lesionMap = buildPreviewByImageId([
      { image_id: "image_2", has_lesion_crop: true, has_lesion_mask: true },
    ]);

    expect(applyRoiPreviewFlags(images as any, roiMap)[0]).toMatchObject({
      has_roi_crop: true,
      has_medsam_mask: true,
    });
    expect(applyLesionPreviewFlags(images as any, lesionMap)[1]).toMatchObject({
      has_lesion_crop: true,
      has_lesion_mask: true,
    });

    const entries = await resolvePreviewArtifactEntries({
      images: [{ image_id: "image_1" }, { image_id: "image_2" }],
      canResolve: (image) => image.image_id === "image_1",
      fetchUrl: async (image) => `/preview/${image.image_id}`,
    });

    expect(entries).toEqual([
      ["image_1", "/preview/image_1"],
      ["image_2", null],
    ]);
    expect(collectResolvedPreviewUrls(entries)).toEqual(["/preview/image_1"]);
    expect(mergeResolvedPreviewUrls({}, entries)).toEqual({
      image_1: "/preview/image_1",
      image_2: null,
    });
  });

  it("builds roi and lesion preview cards with resolved urls", async () => {
    const roi = await buildRoiPreviewCards({
      items: [
        {
          image_id: "image_1",
          has_roi_crop: true,
          has_medsam_mask: true,
        },
      ],
      fetchSourcePreviewUrl: async (imageId) => `/source/${imageId}`,
      fetchRoiCropUrl: async (imageId) => `/roi/${imageId}`,
      fetchMedsamMaskUrl: async (imageId) => `/mask/${imageId}`,
    });
    const lesion = await buildLesionPreviewCards({
      items: [
        {
          image_id: "image_2",
          has_lesion_crop: true,
          has_lesion_mask: false,
        },
      ],
      fetchSourcePreviewUrl: async (imageId) => `/source/${imageId}`,
      fetchLesionCropUrl: async (imageId) => `/lesion/${imageId}`,
      fetchLesionMaskUrl: async (imageId) => `/lesion-mask/${imageId}`,
    });

    expect(roi.cards[0]).toMatchObject({
      source_preview_url: "/source/image_1",
      roi_crop_url: "/roi/image_1",
      medsam_mask_url: "/mask/image_1",
    });
    expect(roi.urls).toEqual([
      "/source/image_1",
      "/roi/image_1",
      "/mask/image_1",
    ]);
    expect(lesion.cards[0]).toMatchObject({
      source_preview_url: "/source/image_2",
      lesion_crop_url: "/lesion/image_2",
      lesion_mask_url: null,
    });
  });
});
