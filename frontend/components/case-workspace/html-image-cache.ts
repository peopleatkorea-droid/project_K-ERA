"use client";

const htmlImageCache = new Map<string, Promise<HTMLImageElement>>();

export function loadCachedHtmlImage(src: string): Promise<HTMLImageElement> {
  const cachedImage = htmlImageCache.get(src);
  if (cachedImage) {
    return cachedImage;
  }

  const nextImage = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => {
      htmlImageCache.delete(src);
      reject(new Error(`Unable to load image: ${src}`));
    };
    image.src = src;
  });

  htmlImageCache.set(src, nextImage);
  return nextImage;
}
