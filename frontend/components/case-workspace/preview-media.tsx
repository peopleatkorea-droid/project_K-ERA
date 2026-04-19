"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "../../lib/cn";
import { loadCachedHtmlImage } from "./html-image-cache";
import { drawCachedMaskOverlay } from "./mask-overlay-renderer";
import { scheduleDeferredBrowserTask } from "./case-workspace-site-data-helpers";
import { useViewportActivation } from "./use-viewport-activation";
import {
  liveCropCanvasClass,
  liveCropFallbackClass,
  panelImageFallbackClass,
  panelImageOverlayClass,
  panelImageOverlayFallbackClass,
} from "../ui/workspace-patterns";
import type { NormalizedBox } from "./shared";

const DEFAULT_MASK_TINT = [125, 211, 195] as const;

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
  const { activationRef, isActive } = useViewportActivation<HTMLElement>();
  const setCanvasRef = useCallback(
    (node: HTMLCanvasElement | null) => {
      canvasRef.current = node;
      activationRef(node);
    },
    [activationRef],
  );

  useEffect(() => {
    if (!isActive) {
      setPreviewReady(false);
      return;
    }
    let cancelled = false;

    async function renderPreview() {
      if (!canvasRef.current || !sourceUrl || !box) {
        setPreviewReady(false);
        return;
      }

      try {
        const sourceImage = await loadCachedHtmlImage(sourceUrl);
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

    const cancelDeferredRender = scheduleDeferredBrowserTask(() => {
      void renderPreview();
    }, 120);
    return () => {
      cancelled = true;
      cancelDeferredRender();
    };
  }, [box, isActive, sourceUrl]);

  if (!sourceUrl || !box) {
    return <div className={panelImageFallbackClass}>{alt}</div>;
  }

  if (!isActive) {
    return (
      <div ref={activationRef} className={cn(panelImageFallbackClass, fallbackClassName)}>
        {alt}
      </div>
    );
  }

  return (
    <>
      <canvas ref={setCanvasRef} className={cn(liveCropCanvasClass(previewReady), className)} aria-label={alt} />
      {!previewReady ? (
        <img
          src={sourceUrl}
          alt={alt}
          decoding="async"
          loading="lazy"
          className={cn(liveCropFallbackClass(previewReady), fallbackClassName)}
        />
      ) : null}
    </>
  );
}

export function MaskOverlayPreview({
  sourceUrl,
  maskUrl,
  alt,
  tint = DEFAULT_MASK_TINT,
  className,
  fallbackClassName,
}: {
  sourceUrl: string | null | undefined;
  maskUrl: string | null | undefined;
  alt: string;
  tint?: readonly [number, number, number];
  className?: string;
  fallbackClassName?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [overlayReady, setOverlayReady] = useState(false);
  const { activationRef, isActive } = useViewportActivation<HTMLElement>();
  const setCanvasRef = useCallback(
    (node: HTMLCanvasElement | null) => {
      canvasRef.current = node;
      activationRef(node);
    },
    [activationRef],
  );

  useEffect(() => {
    if (!isActive) {
      setOverlayReady(false);
      return;
    }
    let cancelled = false;

    async function renderOverlay() {
      if (!canvasRef.current || !sourceUrl || !maskUrl) {
        setOverlayReady(false);
        return;
      }
      try {
        const canvas = canvasRef.current;
        if (cancelled || !canvas) {
          return;
        }
        const pixelRatio = typeof window === "undefined" ? 1 : Math.max(1, window.devicePixelRatio || 1);
        const maxDimension = Math.max(
          320,
          Math.round(Math.max(canvas.clientWidth || 0, canvas.clientHeight || 0, 320) * pixelRatio),
        );
        const rendered = await drawCachedMaskOverlay(canvas, sourceUrl, maskUrl, tint, { maxDimension });
        if (!cancelled) {
          setOverlayReady(rendered);
        }
      } catch {
        if (!cancelled) {
          setOverlayReady(false);
        }
      }
    }

    const cancelDeferredRender = scheduleDeferredBrowserTask(() => {
      void renderOverlay();
    }, 180);
    return () => {
      cancelled = true;
      cancelDeferredRender();
    };
  }, [isActive, maskUrl, sourceUrl, tint[0], tint[1], tint[2]]);

  if (!sourceUrl || !maskUrl) {
    return <div className={panelImageFallbackClass}>{alt}</div>;
  }

  if (!isActive) {
    return (
      <div ref={activationRef} className={cn(panelImageFallbackClass, fallbackClassName)}>
        {alt}
      </div>
    );
  }

  return (
    <>
      <canvas ref={setCanvasRef} className={cn(panelImageOverlayClass(overlayReady), className)} aria-label={alt} />
      {!overlayReady ? (
        <img
          src={sourceUrl}
          alt={alt}
          decoding="async"
          loading="lazy"
          className={cn(panelImageOverlayFallbackClass(overlayReady), fallbackClassName)}
        />
      ) : null}
    </>
  );
}
