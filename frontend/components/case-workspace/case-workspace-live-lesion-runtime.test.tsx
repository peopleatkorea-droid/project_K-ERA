import { describe, expect, it, vi } from "vitest";

import {
  hydrateLiveLesionPreviewArtifacts,
  hydrateStoredCaseLesionPreviewGroups,
  mergeSelectedCaseImageUpdate,
} from "./case-workspace-live-lesion-runtime";

describe("case-workspace live lesion runtime", () => {
  it("hydrates stored lesion previews and skips already resolved images", async () => {
    const currentPreviews = {
      image_1: {
        job_id: null,
        status: "running",
        error: null,
        backend: null,
        prompt_signature: "sig_1",
        lesion_mask_url: null,
        lesion_crop_url: null,
      },
      image_2: {
        job_id: "job_2",
        status: "done",
        error: null,
        backend: "medsam",
        prompt_signature: "sig_2",
        lesion_mask_url: "/existing-mask",
        lesion_crop_url: "/existing-crop",
      },
    } as any;
    const currentUrls: Record<string, string[]> = {
      image_1: ["blob:old"],
      image_2: ["blob:keep"],
    };
    const revokeObjectUrls = vi.fn();
    const onHydratedPreview = vi.fn((imageId: string, nextState: any) => {
      currentPreviews[imageId] = nextState;
    });

    await hydrateStoredCaseLesionPreviewGroups({
      siteId: "site-1",
      token: "token",
      groups: [
        {
          patientId: "P-001",
          visitDate: "Initial",
          images: [
            { image_id: "image_1" },
            { image_id: "image_2" },
          ] as any,
        },
      ],
      fetchStoredCaseLesionPreview: vi.fn(async () => [
        {
          image_id: "image_1",
          has_lesion_mask: true,
          has_lesion_crop: true,
          backend: "medsam",
        },
        {
          image_id: "image_2",
          has_lesion_mask: true,
          has_lesion_crop: true,
          backend: "medsam",
        },
      ]),
      fetchCaseLesionPreviewArtifactUrl: vi.fn(
        async (_siteId, _patientId, _visitDate, imageId, artifactKind) =>
          `/${imageId}/${artifactKind}`,
      ),
      revokeObjectUrls,
      shouldCancel: () => false,
      getCurrentPreview: (imageId) => currentPreviews[imageId],
      getCurrentUrls: (imageId) => currentUrls[imageId] ?? [],
      setCurrentUrls: (imageId, urls) => {
        currentUrls[imageId] = urls;
      },
      onHydratedPreview,
    });

    expect(revokeObjectUrls).toHaveBeenCalledWith(["blob:old"]);
    expect(onHydratedPreview).toHaveBeenCalledTimes(1);
    expect(currentPreviews.image_1).toMatchObject({
      status: "done",
      backend: "medsam",
      prompt_signature: "sig_1",
      lesion_mask_url: "/image_1/lesion_mask",
      lesion_crop_url: "/image_1/lesion_crop",
    });
    expect(currentUrls.image_1).toEqual([
      "/image_1/lesion_mask",
      "/image_1/lesion_crop",
    ]);
    expect(currentPreviews.image_2.lesion_mask_url).toBe("/existing-mask");
  });

  it("hydrates settled live lesion previews only while the request version is current", async () => {
    const currentPreviews = {
      image_1: {
        job_id: "job_1",
        status: "running",
        error: null,
        backend: "medsam",
        prompt_signature: "sig_1",
        lesion_mask_url: null,
        lesion_crop_url: null,
      },
    } as any;
    const currentUrls: Record<string, string[]> = {
      image_1: ["blob:old-mask"],
    };
    const revokeObjectUrls = vi.fn();
    const onHydratedPreview = vi.fn((imageId: string, nextState: any) => {
      currentPreviews[imageId] = nextState;
    });

    await hydrateLiveLesionPreviewArtifacts({
      siteId: "site-1",
      token: "token",
      imageId: "image_1",
      job: {
        job_id: "job_1",
        patient_id: "P-001",
        visit_date: "Initial",
        has_lesion_mask: true,
        has_lesion_crop: false,
        backend: "medsam",
        prompt_signature: "sig_1",
      },
      requestVersion: 2,
      fetchCaseLesionPreviewArtifactUrl: vi.fn(
        async (_siteId, _patientId, _visitDate, imageId, artifactKind) =>
          `/${imageId}/${artifactKind}`,
      ),
      revokeObjectUrls,
      getCurrentRequestVersion: () => 2,
      getCurrentPreview: (imageId) => currentPreviews[imageId],
      getCurrentUrls: (imageId) => currentUrls[imageId] ?? [],
      setCurrentUrls: (imageId, urls) => {
        currentUrls[imageId] = urls;
      },
      onHydratedPreview,
    });

    expect(revokeObjectUrls).toHaveBeenCalledWith(["blob:old-mask"]);
    expect(onHydratedPreview).toHaveBeenCalledTimes(1);
    expect(currentPreviews.image_1).toMatchObject({
      status: "done",
      lesion_mask_url: "/image_1/lesion_mask",
      lesion_crop_url: null,
    });
  });

  it("keeps preview state untouched when a settled preview becomes stale", async () => {
    const currentPreviews = {
      image_1: {
        job_id: "job_1",
        status: "running",
        error: null,
        backend: "medsam",
        prompt_signature: "sig_1",
        lesion_mask_url: null,
        lesion_crop_url: null,
      },
    } as any;
    const currentUrls: Record<string, string[]> = {
      image_1: ["blob:old-mask"],
    };
    const revokeObjectUrls = vi.fn();
    const onHydratedPreview = vi.fn();
    let requestVersion = 2;

    await hydrateLiveLesionPreviewArtifacts({
      siteId: "site-1",
      token: "token",
      imageId: "image_1",
      job: {
        job_id: "job_1",
        patient_id: "P-001",
        visit_date: "Initial",
        has_lesion_mask: true,
        has_lesion_crop: false,
        backend: "medsam",
        prompt_signature: "sig_1",
      },
      requestVersion: 2,
      fetchCaseLesionPreviewArtifactUrl: vi.fn(async () => {
        requestVersion = 3;
        return "/image_1/lesion_mask";
      }),
      revokeObjectUrls,
      getCurrentRequestVersion: () => requestVersion,
      getCurrentPreview: (imageId) => currentPreviews[imageId],
      getCurrentUrls: (imageId) => currentUrls[imageId] ?? [],
      setCurrentUrls: (imageId, urls) => {
        currentUrls[imageId] = urls;
      },
      onHydratedPreview,
    });

    expect(revokeObjectUrls).toHaveBeenCalledWith(["/image_1/lesion_mask"]);
    expect(onHydratedPreview).not.toHaveBeenCalled();
    expect(currentUrls.image_1).toEqual(["blob:old-mask"]);
  });

  it("merges updated image records without losing the existing preview url", () => {
    const merged = mergeSelectedCaseImageUpdate(
      [
        {
          image_id: "image_1",
          preview_url: "/preview-old",
          lesion_prompt_box: null,
        },
        {
          image_id: "image_2",
          preview_url: "/preview-two",
          lesion_prompt_box: null,
        },
      ] as any,
      {
        image_id: "image_1",
        lesion_prompt_box: { x0: 0.1, y0: 0.1, x1: 0.4, y1: 0.4 },
      } as any,
    );

    expect(merged).toEqual([
      expect.objectContaining({
        image_id: "image_1",
        preview_url: "/preview-old",
        lesion_prompt_box: { x0: 0.1, y0: 0.1, x1: 0.4, y1: 0.4 },
      }),
      expect.objectContaining({
        image_id: "image_2",
        preview_url: "/preview-two",
      }),
    ]);
  });
});
