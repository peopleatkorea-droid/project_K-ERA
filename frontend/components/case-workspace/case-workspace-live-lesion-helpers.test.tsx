import { describe, expect, it } from "vitest";

import {
  buildDoneLiveLesionPreviewState,
  buildFailedLiveLesionPreviewState,
  buildLesionPromptBoxMap,
  buildPointerAnchor,
  buildPointerDraftBox,
  buildRunningLiveLesionPreviewState,
  filterPersistableLesionEntries,
  groupImagesWithSavedLesionBoxes,
  hasMeaningfulLesionBox,
  hasSavedLesionPromptBox,
  listChangedLesionBoxImageIds,
  resolveLiveLesionArtifactUrls,
} from "./case-workspace-live-lesion-helpers";

describe("case-workspace live lesion helpers", () => {
  it("builds saved lesion prompt maps and tracks changed image ids", () => {
    const images = [
      {
        image_id: "image_1",
        lesion_prompt_box: { x0: 0.1, y0: 0.2, x1: 0.5, y1: 0.6 },
      },
      {
        image_id: "image_2",
        lesion_prompt_box: null,
      },
    ] as any[];

    const saved = buildLesionPromptBoxMap(
      images as any,
      (value) => value ?? null,
    );
    const drafts = {
      ...saved,
      image_2: { x0: 0.2, y0: 0.2, x1: 0.4, y1: 0.4 },
    };

    expect(saved).toEqual({
      image_1: { x0: 0.1, y0: 0.2, x1: 0.5, y1: 0.6 },
      image_2: null,
    });
    expect(listChangedLesionBoxImageIds(images as any, drafts, saved)).toEqual([
      "image_2",
    ]);
    expect(hasSavedLesionPromptBox(saved)).toBe(true);
    expect(hasMeaningfulLesionBox(saved.image_1)).toBe(true);
    expect(hasMeaningfulLesionBox({ x0: 0.1, y0: 0.1, x1: 0.105, y1: 0.4 })).toBe(
      false,
    );
  });

  it("groups boxed images by patient and visit and deduplicates by image id", () => {
    const groups = groupImagesWithSavedLesionBoxes(
      [
        {
          image_id: "image_1",
          patient_id: "patient_1",
          visit_date: "2024-01-01",
          lesion_prompt_box: { x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.5 },
        },
        {
          image_id: "image_1",
          patient_id: "patient_1",
          visit_date: "2024-01-01",
          lesion_prompt_box: { x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.5 },
        },
        {
          image_id: "image_2",
          patient_id: "patient_1",
          visit_date: "2024-01-02",
          lesion_prompt_box: { x0: 0.2, y0: 0.2, x1: 0.6, y1: 0.7 },
        },
        {
          image_id: "image_3",
          patient_id: "patient_2",
          visit_date: "2024-01-03",
          lesion_prompt_box: null,
        },
      ] as any,
      (value) => value ?? null,
    );

    expect(groups).toEqual([
      {
        patientId: "patient_1",
        visitDate: "2024-01-01",
        images: [expect.objectContaining({ image_id: "image_1" })],
      },
      {
        patientId: "patient_1",
        visitDate: "2024-01-02",
        images: [expect.objectContaining({ image_id: "image_2" })],
      },
    ]);
  });

  it("builds running, done, and failed preview states without losing prior urls", () => {
    const running = buildRunningLiveLesionPreviewState(undefined, {
      job_id: "job_1",
      backend: "medsam",
      prompt_signature: "sig_1",
    });
    const done = buildDoneLiveLesionPreviewState(
      {
        ...running,
        lesion_mask_url: "/old-mask",
        lesion_crop_url: "/old-crop",
      },
      {
        job_id: "job_1",
        backend: null,
        prompt_signature: null,
      },
      {
        lesionMaskUrl: "/mask",
        lesionCropUrl: "/crop",
      },
    );
    const failed = buildFailedLiveLesionPreviewState(done, {
      jobId: "job_1",
      error: "failed",
      backend: null,
      promptSignature: null,
    });

    expect(running).toMatchObject({
      job_id: "job_1",
      status: "running",
      backend: "medsam",
      prompt_signature: "sig_1",
      lesion_mask_url: null,
      lesion_crop_url: null,
    });
    expect(done).toMatchObject({
      job_id: "job_1",
      status: "done",
      backend: "medsam",
      prompt_signature: "sig_1",
      lesion_mask_url: "/mask",
      lesion_crop_url: "/crop",
    });
    expect(failed).toMatchObject({
      job_id: "job_1",
      status: "failed",
      error: "failed",
      lesion_mask_url: "/mask",
      lesion_crop_url: "/crop",
    });
  });

  it("filters persistable lesion entries and computes pointer draft geometry", () => {
    const entries = filterPersistableLesionEntries([
      {
        imageId: "image_1",
        lesionBox: { x0: 0.1, y0: 0.1, x1: 0.3, y1: 0.4 },
      },
      {
        imageId: "image_1",
        lesionBox: { x0: 0.2, y0: 0.2, x1: 0.6, y1: 0.7 },
      },
      {
        imageId: "image_2",
        lesionBox: { x0: 0.2, y0: 0.2, x1: 0.205, y1: 0.7 },
      },
    ]);
    const anchor = buildPointerAnchor(25, 50, {
      left: 0,
      top: 0,
      width: 100,
      height: 200,
    });

    expect(entries).toEqual([
      {
        imageId: "image_1",
        lesionBox: { x0: 0.2, y0: 0.2, x1: 0.6, y1: 0.7 },
      },
    ]);
    expect(anchor).toEqual({ x: 0.25, y: 0.25 });
    expect(
      buildPointerDraftBox(anchor!, 75, 150, {
        left: 0,
        top: 0,
        width: 100,
        height: 200,
      }),
    ).toEqual({
      x0: 0.25,
      y0: 0.25,
      x1: 0.75,
      y1: 0.75,
    });
  });

  it("resolves lesion artifact urls independently and tolerates partial failures", async () => {
    await expect(
      resolveLiveLesionArtifactUrls({
        hasLesionMask: true,
        hasLesionCrop: true,
        fetchLesionMaskUrl: async () => "/mask/image_1",
        fetchLesionCropUrl: async () => {
          throw new Error("crop unavailable");
        },
      }),
    ).resolves.toEqual({
      lesionMaskUrl: "/mask/image_1",
      lesionCropUrl: null,
      urls: ["/mask/image_1"],
    });
  });
});
