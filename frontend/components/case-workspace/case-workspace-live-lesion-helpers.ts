"use client";

import { clamp01, normalizeBox } from "./case-workspace-core-helpers";
import type {
  LesionBoxMap,
  LiveLesionPreviewState,
  NormalizedBox,
  SavedImagePreview,
} from "./shared";

type ToNormalizedBox = (
  lesionPromptBox: SavedImagePreview["lesion_prompt_box"],
) => NormalizedBox | null;

type ElementRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type LiveLesionPreviewJobLike = {
  job_id: string | null;
  backend?: string | null;
  prompt_signature?: string | null;
};

export type SavedLesionPreviewGroup = {
  patientId: string;
  visitDate: string;
  images: SavedImagePreview[];
};

export type PersistableLesionEntry = {
  imageId: string;
  lesionBox: NormalizedBox;
  isRepresentative?: boolean;
};

export type PointerAnchor = {
  x: number;
  y: number;
};

export function revokeObjectUrls(urls: string[]) {
  for (const url of urls) {
    if (String(url).startsWith("blob:")) {
      URL.revokeObjectURL(url);
    }
  }
}

export function areNormalizedBoxesEqual(
  left: NormalizedBox | null | undefined,
  right: NormalizedBox | null | undefined,
): boolean {
  if (!left || !right) {
    return left == null && right == null;
  }
  return (
    left.x0 === right.x0 &&
    left.y0 === right.y0 &&
    left.x1 === right.x1 &&
    left.y1 === right.y1
  );
}

export function hasMeaningfulLesionBox(
  lesionBox: NormalizedBox | null | undefined,
): lesionBox is NormalizedBox {
  return Boolean(
    lesionBox &&
      lesionBox.x1 - lesionBox.x0 >= 0.01 &&
      lesionBox.y1 - lesionBox.y0 >= 0.01,
  );
}

export function buildLesionPromptBoxMap(
  images: SavedImagePreview[],
  toNormalizedBox: ToNormalizedBox,
): LesionBoxMap {
  return Object.fromEntries(
    images.map((image) => [
      image.image_id,
      toNormalizedBox(image.lesion_prompt_box),
    ]),
  );
}

export function listChangedLesionBoxImageIds(
  images: SavedImagePreview[],
  lesionPromptDrafts: LesionBoxMap,
  lesionPromptSaved: LesionBoxMap,
): string[] {
  return images
    .map((image) => image.image_id)
    .filter(
      (imageId) =>
        !areNormalizedBoxesEqual(
          lesionPromptDrafts[imageId] ?? null,
          lesionPromptSaved[imageId] ?? null,
        ),
    );
}

export function hasSavedLesionPromptBox(lesionPromptSaved: LesionBoxMap) {
  return Object.values(lesionPromptSaved).some((value) => value);
}

export function groupImagesWithSavedLesionBoxes(
  images: SavedImagePreview[],
  toNormalizedBox: ToNormalizedBox,
): SavedLesionPreviewGroup[] {
  const deduplicated = Array.from(
    new Map(
      images
        .filter((image) => Boolean(toNormalizedBox(image.lesion_prompt_box)))
        .map((image) => [image.image_id, image] as const),
    ).values(),
  );
  const grouped = new Map<string, SavedImagePreview[]>();
  for (const image of deduplicated) {
    if (!image.patient_id || !image.visit_date) {
      continue;
    }
    const key = `${image.patient_id}::${image.visit_date}`;
    const current = grouped.get(key) ?? [];
    current.push(image);
    grouped.set(key, current);
  }
  return Array.from(grouped.entries()).map(([key, caseImages]) => {
    const separatorIndex = key.indexOf("::");
    return {
      patientId: key.slice(0, separatorIndex),
      visitDate: key.slice(separatorIndex + 2),
      images: caseImages,
    };
  });
}

function buildBasePreviewState(
  current: LiveLesionPreviewState | undefined,
): LiveLesionPreviewState {
  return (
    current ?? {
      job_id: null,
      status: "idle",
      error: null,
      backend: null,
      prompt_signature: null,
      lesion_mask_url: null,
      lesion_crop_url: null,
    }
  );
}

export function buildRunningLiveLesionPreviewState(
  current: LiveLesionPreviewState | undefined,
  job: LiveLesionPreviewJobLike,
): LiveLesionPreviewState {
  const base = buildBasePreviewState(current);
  return {
    ...base,
    job_id: job.job_id,
    status: "running",
    error: null,
    backend: job.backend ?? base.backend,
    prompt_signature: job.prompt_signature ?? base.prompt_signature,
  };
}

export function buildDoneLiveLesionPreviewState(
  current: LiveLesionPreviewState | undefined,
  job: LiveLesionPreviewJobLike,
  urls: {
    lesionMaskUrl: string | null;
    lesionCropUrl: string | null;
  },
): LiveLesionPreviewState {
  const base = buildBasePreviewState(current);
  return {
    job_id: job.job_id,
    status: "done",
    error: null,
    backend: job.backend ?? base.backend,
    prompt_signature: job.prompt_signature ?? base.prompt_signature,
    lesion_mask_url: urls.lesionMaskUrl,
    lesion_crop_url: urls.lesionCropUrl,
  };
}

export function buildFailedLiveLesionPreviewState(
  current: LiveLesionPreviewState | undefined,
  args: {
    jobId: string | null;
    error: string;
    backend: string | null;
    promptSignature: string | null;
  },
): LiveLesionPreviewState {
  const base = buildBasePreviewState(current);
  return {
    ...base,
    job_id: args.jobId,
    status: "failed",
    error: args.error,
    backend: args.backend ?? base.backend,
    prompt_signature: args.promptSignature ?? base.prompt_signature,
  };
}

export function filterPersistableLesionEntries(
  entries: PersistableLesionEntry[],
): PersistableLesionEntry[] {
  return Array.from(
    new Map(
      entries
        .filter(
          (entry) =>
            entry.imageId.trim().length > 0 &&
            hasMeaningfulLesionBox(entry.lesionBox),
        )
        .map((entry) => [entry.imageId, entry] as const),
    ).values(),
  );
}

export async function resolveLiveLesionArtifactUrls(args: {
  hasLesionMask?: boolean;
  hasLesionCrop?: boolean;
  fetchLesionMaskUrl: () => Promise<string | null>;
  fetchLesionCropUrl: () => Promise<string | null>;
}): Promise<{
  lesionMaskUrl: string | null;
  lesionCropUrl: string | null;
  urls: string[];
}> {
  const urls: string[] = [];
  let lesionMaskUrl: string | null = null;
  let lesionCropUrl: string | null = null;

  if (args.hasLesionMask) {
    try {
      lesionMaskUrl = await args.fetchLesionMaskUrl();
      if (lesionMaskUrl) {
        urls.push(lesionMaskUrl);
      }
    } catch {
      lesionMaskUrl = null;
    }
  }

  if (args.hasLesionCrop) {
    try {
      lesionCropUrl = await args.fetchLesionCropUrl();
      if (lesionCropUrl) {
        urls.push(lesionCropUrl);
      }
    } catch {
      lesionCropUrl = null;
    }
  }

  return {
    lesionMaskUrl,
    lesionCropUrl,
    urls,
  };
}

export function buildPointerAnchor(
  clientX: number,
  clientY: number,
  rect: ElementRect,
): PointerAnchor | null {
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }
  return {
    x: clamp01((clientX - rect.left) / rect.width),
    y: clamp01((clientY - rect.top) / rect.height),
  };
}

export function buildPointerDraftBox(
  anchor: PointerAnchor,
  clientX: number,
  clientY: number,
  rect: ElementRect,
): NormalizedBox | null {
  const current = buildPointerAnchor(clientX, clientY, rect);
  if (!current) {
    return null;
  }
  return normalizeBox({
    x0: anchor.x,
    y0: anchor.y,
    x1: current.x,
    y1: current.y,
  });
}
