"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "../../lib/cn";
import {
  liveCropCanvasClass,
  liveCropFallbackClass,
  panelImageFallbackClass,
  panelImageOverlayClass,
  panelImageOverlayFallbackClass,
} from "../ui/workspace-patterns";
import type { NormalizedBox } from "./shared";

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load image: ${src}`));
    image.src = src;
  });
}

export function LiveCropPreview({
  sourceUrl,
  box,
  alt,
  className,
  fallbackClassName,
}: {
  sourceUrl: string | null | undefined;
  box: NormalizedBox | null | undefined;
  alt: string;
  className?: string;
  fallbackClassName?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [previewReady, setPreviewReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function renderPreview() {
      if (!canvasRef.current || !sourceUrl || !box) {
        setPreviewReady(false);
        return;
      }

      try {
        const sourceImage = await loadHtmlImage(sourceUrl);
        if (cancelled || !canvasRef.current) {
          return;
        }

        const cropWidth = Math.max(1, Math.round((box.x1 - box.x0) * (sourceImage.naturalWidth || sourceImage.width)));
        const cropHeight = Math.max(1, Math.round((box.y1 - box.y0) * (sourceImage.naturalHeight || sourceImage.height)));
        const cropX = Math.max(0, Math.round(box.x0 * (sourceImage.naturalWidth || sourceImage.width)));
        const cropY = Math.max(0, Math.round(box.y0 * (sourceImage.naturalHeight || sourceImage.height)));
        const scale = Math.min(1, 480 / Math.max(cropWidth, cropHeight));

        const canvas = canvasRef.current;
        canvas.width = Math.max(1, Math.round(cropWidth * scale));
        canvas.height = Math.max(1, Math.round(cropHeight * scale));
        const context = canvas.getContext("2d");
        if (!context) {
          setPreviewReady(false);
          return;
        }

        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(sourceImage, cropX, cropY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
        setPreviewReady(true);
      } catch {
        if (!cancelled) {
          setPreviewReady(false);
        }
      }
    }

    void renderPreview();
    return () => {
      cancelled = true;
    };
  }, [box, sourceUrl]);

  if (!sourceUrl || !box) {
    return <div className={panelImageFallbackClass}>{alt}</div>;
  }

  return (
    <>
      <canvas ref={canvasRef} className={cn(liveCropCanvasClass(previewReady), className)} aria-label={alt} />
      {!previewReady ? <img src={sourceUrl} alt={alt} className={cn(liveCropFallbackClass(previewReady), fallbackClassName)} /> : null}
    </>
  );
}

export function MaskOverlayPreview({
  sourceUrl,
  maskUrl,
  alt,
  tint = [125, 211, 195],
  className,
  fallbackClassName,
}: {
  sourceUrl: string | null | undefined;
  maskUrl: string | null | undefined;
  alt: string;
  tint?: [number, number, number];
  className?: string;
  fallbackClassName?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [overlayReady, setOverlayReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function renderOverlay() {
      if (!canvasRef.current || !sourceUrl || !maskUrl) {
        setOverlayReady(false);
        return;
      }
      try {
        const [sourceImage, maskImage] = await Promise.all([loadHtmlImage(sourceUrl), loadHtmlImage(maskUrl)]);
        if (cancelled || !canvasRef.current) {
          return;
        }
        const canvas = canvasRef.current;
        canvas.width = sourceImage.naturalWidth || sourceImage.width;
        canvas.height = sourceImage.naturalHeight || sourceImage.height;
        const context = canvas.getContext("2d");
        if (!context) {
          setOverlayReady(false);
          return;
        }

        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(sourceImage, 0, 0, canvas.width, canvas.height);

        const maskCanvas = document.createElement("canvas");
        maskCanvas.width = canvas.width;
        maskCanvas.height = canvas.height;
        const maskContext = maskCanvas.getContext("2d");
        if (!maskContext) {
          setOverlayReady(false);
          return;
        }
        maskContext.drawImage(maskImage, 0, 0, canvas.width, canvas.height);
        const maskData = maskContext.getImageData(0, 0, canvas.width, canvas.height);
        const sourceData = context.getImageData(0, 0, canvas.width, canvas.height);
        const finalData = context.createImageData(canvas.width, canvas.height);
        finalData.data.set(sourceData.data);

        for (let index = 0; index < maskData.data.length; index += 4) {
          const intensity = maskData.data[index];
          if (intensity > 24) {
            const alpha = 0.34;
            finalData.data[index] = Math.round((1 - alpha) * sourceData.data[index] + alpha * tint[0]);
            finalData.data[index + 1] = Math.round((1 - alpha) * sourceData.data[index + 1] + alpha * tint[1]);
            finalData.data[index + 2] = Math.round((1 - alpha) * sourceData.data[index + 2] + alpha * tint[2]);
            finalData.data[index + 3] = 255;
          }
        }

        for (let y = 1; y < canvas.height - 1; y += 1) {
          for (let x = 1; x < canvas.width - 1; x += 1) {
            const pixelIndex = (y * canvas.width + x) * 4;
            const inside = maskData.data[pixelIndex] > 24;
            if (!inside) {
              continue;
            }
            const neighbors = [
              ((y - 1) * canvas.width + x) * 4,
              ((y + 1) * canvas.width + x) * 4,
              (y * canvas.width + (x - 1)) * 4,
              (y * canvas.width + (x + 1)) * 4,
            ];
            if (neighbors.some((neighborIndex) => maskData.data[neighborIndex] <= 24)) {
              finalData.data[pixelIndex] = Math.min(255, tint[0] + 20);
              finalData.data[pixelIndex + 1] = Math.min(255, tint[1] + 20);
              finalData.data[pixelIndex + 2] = Math.min(255, tint[2] + 20);
              finalData.data[pixelIndex + 3] = 255;
            }
          }
        }

        context.putImageData(finalData, 0, 0);
        setOverlayReady(true);
      } catch {
        if (!cancelled) {
          setOverlayReady(false);
        }
      }
    }

    void renderOverlay();
    return () => {
      cancelled = true;
    };
  }, [maskUrl, sourceUrl, tint]);

  if (!sourceUrl || !maskUrl) {
    return <div className={panelImageFallbackClass}>{alt}</div>;
  }

  return (
    <>
      <canvas ref={canvasRef} className={cn(panelImageOverlayClass(overlayReady), className)} aria-label={alt} />
      {!overlayReady ? <img src={sourceUrl} alt={alt} className={cn(panelImageOverlayFallbackClass(overlayReady), fallbackClassName)} /> : null}
    </>
  );
}
