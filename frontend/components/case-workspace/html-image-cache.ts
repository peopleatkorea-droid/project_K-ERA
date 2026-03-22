"use client";

const htmlImageCache = new Map<string, Promise<HTMLImageElement>>();

function shouldLoadImageThroughBlob(src: string): boolean {
  const normalized = src.trim();
  if (!normalized) {
    return false;
  }
  try {
    const url = new URL(normalized, typeof window !== "undefined" ? window.location.href : "http://localhost");
    return url.protocol === "asset:" || url.hostname === "asset.localhost";
  } catch {
    return normalized.startsWith("asset:");
  }
}

async function resolveCanvasSafeImageSrc(src: string): Promise<{ imageSrc: string; revokeObjectUrl?: () => void }> {
  if (!shouldLoadImageThroughBlob(src)) {
    return { imageSrc: src };
  }
  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`Unable to fetch image: ${src}`);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  return {
    imageSrc: objectUrl,
    revokeObjectUrl: () => URL.revokeObjectURL(objectUrl),
  };
}

export function loadCachedHtmlImage(src: string): Promise<HTMLImageElement> {
  const cachedImage = htmlImageCache.get(src);
  if (cachedImage) {
    return cachedImage;
  }

  const nextImage = (async () => {
    const { imageSrc, revokeObjectUrl } = await resolveCanvasSafeImageSrc(src);
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.crossOrigin = "anonymous";
      image.onload = () => {
        revokeObjectUrl?.();
        resolve(image);
      };
      image.onerror = () => {
        revokeObjectUrl?.();
        htmlImageCache.delete(src);
        reject(new Error(`Unable to load image: ${src}`));
      };
      image.src = imageSrc;
    });
  })().catch((error) => {
    htmlImageCache.delete(src);
    throw error;
  });

  htmlImageCache.set(src, nextImage);
  return nextImage;
}

export function clearCachedHtmlImages() {
  htmlImageCache.clear();
}
