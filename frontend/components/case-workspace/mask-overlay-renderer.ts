"use client";

import { loadCachedHtmlImage } from "./html-image-cache";

type MaskOverlayTint = readonly [number, number, number];
type MaskOverlayOptions = {
  maxDimension?: number;
};

const MAX_MASK_OVERLAY_CACHE_ENTRIES = 24;
const maskOverlayCache = new Map<string, Promise<HTMLCanvasElement>>();
const DEFAULT_MASK_OVERLAY_MAX_DIMENSION = 960;

function buildMaskOverlayCacheKey(sourceUrl: string, maskUrl: string, tint: MaskOverlayTint, maxDimension: number): string {
  return `${sourceUrl}::${maskUrl}::${tint.join(",")}::${maxDimension}`;
}

function rememberMaskOverlay(key: string, value: Promise<HTMLCanvasElement>) {
  if (maskOverlayCache.has(key)) {
    maskOverlayCache.delete(key);
  }
  maskOverlayCache.set(key, value);
  while (maskOverlayCache.size > MAX_MASK_OVERLAY_CACHE_ENTRIES) {
    const oldestKey = maskOverlayCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    maskOverlayCache.delete(oldestKey);
  }
}

async function renderMaskOverlay(
  sourceUrl: string,
  maskUrl: string,
  tint: MaskOverlayTint,
  options: MaskOverlayOptions = {},
): Promise<HTMLCanvasElement> {
  const maxDimension = Math.max(1, options.maxDimension ?? DEFAULT_MASK_OVERLAY_MAX_DIMENSION);
  const cacheKey = buildMaskOverlayCacheKey(sourceUrl, maskUrl, tint, maxDimension);
  const cachedOverlay = maskOverlayCache.get(cacheKey);
  if (cachedOverlay) {
    return cachedOverlay;
  }

  const nextOverlay = (async () => {
    const [sourceImage, maskImage] = await Promise.all([loadCachedHtmlImage(sourceUrl), loadCachedHtmlImage(maskUrl)]);
    const sourceWidth = sourceImage.naturalWidth || sourceImage.width;
    const sourceHeight = sourceImage.naturalHeight || sourceImage.height;
    const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));

    const finalCanvas = document.createElement("canvas");
    finalCanvas.width = width;
    finalCanvas.height = height;
    const finalContext = finalCanvas.getContext("2d");
    if (!finalContext) {
      throw new Error("Unable to acquire final overlay context");
    }

    finalContext.drawImage(sourceImage, 0, 0, width, height);

    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = width;
    maskCanvas.height = height;
    const maskContext = maskCanvas.getContext("2d");
    if (!maskContext) {
      throw new Error("Unable to acquire mask overlay context");
    }

    maskContext.drawImage(maskImage, 0, 0, width, height);
    const maskData = maskContext.getImageData(0, 0, width, height);
    const sourceData = finalContext.getImageData(0, 0, width, height);
    const overlayData = finalContext.createImageData(width, height);
    overlayData.data.set(sourceData.data);

    for (let index = 0; index < maskData.data.length; index += 4) {
      const intensity = maskData.data[index];
      if (intensity <= 24) {
        continue;
      }
      const alpha = 0.34;
      overlayData.data[index] = Math.round((1 - alpha) * sourceData.data[index] + alpha * tint[0]);
      overlayData.data[index + 1] = Math.round((1 - alpha) * sourceData.data[index + 1] + alpha * tint[1]);
      overlayData.data[index + 2] = Math.round((1 - alpha) * sourceData.data[index + 2] + alpha * tint[2]);
      overlayData.data[index + 3] = 255;
    }

    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const pixelIndex = (y * width + x) * 4;
        if (maskData.data[pixelIndex] <= 24) {
          continue;
        }
        const neighbors = [
          ((y - 1) * width + x) * 4,
          ((y + 1) * width + x) * 4,
          (y * width + (x - 1)) * 4,
          (y * width + (x + 1)) * 4,
        ];
        if (neighbors.some((neighborIndex) => maskData.data[neighborIndex] <= 24)) {
          overlayData.data[pixelIndex] = Math.min(255, tint[0] + 20);
          overlayData.data[pixelIndex + 1] = Math.min(255, tint[1] + 20);
          overlayData.data[pixelIndex + 2] = Math.min(255, tint[2] + 20);
          overlayData.data[pixelIndex + 3] = 255;
        }
      }
    }

    finalContext.putImageData(overlayData, 0, 0);
    return finalCanvas;
  })().catch((error) => {
    maskOverlayCache.delete(cacheKey);
    throw error;
  });

  rememberMaskOverlay(cacheKey, nextOverlay);
  return nextOverlay;
}

export async function drawCachedMaskOverlay(
  canvas: HTMLCanvasElement,
  sourceUrl: string,
  maskUrl: string,
  tint: MaskOverlayTint,
  options?: MaskOverlayOptions,
): Promise<boolean> {
  const renderedOverlay = await renderMaskOverlay(sourceUrl, maskUrl, tint, options);
  const context = canvas.getContext("2d");
  if (!context) {
    return false;
  }

  canvas.width = renderedOverlay.width;
  canvas.height = renderedOverlay.height;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(renderedOverlay, 0, 0, canvas.width, canvas.height);
  return true;
}
