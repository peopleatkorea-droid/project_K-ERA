"use client";

import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { pick, type Locale } from "../../lib/i18n";
import { drawCachedMaskOverlay } from "./mask-overlay-renderer";
import { scheduleDeferredBrowserTask } from "./case-workspace-site-data-helpers";
import { useStagedRevealCount } from "./use-staged-reveal-count";
import { useViewportActivation } from "./use-viewport-activation";
import {
  panelImageCardClass,
  panelImageCopyClass,
  panelImageFallbackClass,
  panelImageOverlayClass,
  panelImageOverlayFallbackClass,
  panelImagePreviewClass,
  panelImageStackClass,
} from "../ui/workspace-patterns";

function MaskOverlayPreview({
  sourceUrl,
  maskUrl,
  alt,
  tint = [125, 211, 195],
}: {
  sourceUrl: string | null | undefined;
  maskUrl: string | null | undefined;
  alt: string;
  tint?: [number, number, number];
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
  }, [isActive, maskUrl, sourceUrl, tint]);

  if (!sourceUrl || !maskUrl) {
    return <div className={panelImageFallbackClass}>{alt}</div>;
  }

  if (!isActive) {
    return <div ref={activationRef} className={panelImageFallbackClass}>{alt}</div>;
  }

  return (
    <>
      <canvas ref={setCanvasRef} className={panelImageOverlayClass(overlayReady)} aria-label={alt} />
      {!overlayReady ? (
        <img
          src={sourceUrl}
          alt={alt}
          decoding="async"
          loading="lazy"
          className={panelImageOverlayFallbackClass(overlayReady)}
        />
      ) : null}
    </>
  );
}

type Props = {
  locale: Locale;
  representativePreviewUrl: string | null | undefined;
  roiCropUrl: string | null | undefined;
  gradcamUrl: string | null | undefined;
  gradcamCorneaUrl: string | null | undefined;
  gradcamLesionUrl: string | null | undefined;
  medsamMaskUrl: string | null | undefined;
  lesionCropUrl: string | null | undefined;
  lesionMaskUrl: string | null | undefined;
  emptyMessage?: string | null;
  compact?: boolean;
};

type CompactArtifact = {
  key: string;
  title: string;
  subtitle: string;
  renderPreview: (isPriority: boolean) => ReactNode;
};

type ReviewArtifact = {
  key: string;
  title: string;
  subtitle: string;
  priority: "eager" | "lazy";
  renderPreview: () => ReactNode;
};

function ArtifactImage({
  src,
  alt,
  className,
  priority = "lazy",
}: {
  src: string;
  alt: string;
  className: string;
  priority?: "eager" | "lazy";
}) {
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      loading={priority}
      fetchPriority={priority === "eager" ? "high" : "low"}
      decoding="async"
    />
  );
}

function ValidationArtifactStackInner({
  locale,
  representativePreviewUrl,
  roiCropUrl,
  gradcamUrl,
  gradcamCorneaUrl,
  gradcamLesionUrl,
  medsamMaskUrl,
  lesionCropUrl,
  lesionMaskUrl,
  emptyMessage,
  compact = false,
}: Props) {
  const stackClass = compact ? "grid gap-3" : panelImageStackClass;
  const cardClass = compact
    ? "grid gap-2 rounded-[14px] border border-border bg-surface-muted/80 p-3"
    : panelImageCardClass;
  const copyClass = compact ? "grid gap-0.5 text-xs leading-5 text-muted" : panelImageCopyClass;
  const previewClass = compact
    ? "aspect-[4/3] max-h-[220px] w-full rounded-[12px] border border-border/60 bg-surface object-contain"
    : panelImagePreviewClass;
  const compactArtifacts = useMemo<CompactArtifact[]>(
    () =>
      !compact
        ? []
        : [
        {
          key: "gradcam",
          enabled: Boolean(gradcamUrl && !gradcamCorneaUrl && !gradcamLesionUrl),
          title: pick(locale, "Grad-CAM", "Grad-CAM"),
          subtitle: pick(locale, "Model evidence overlay", "모델 근거 오버레이"),
          renderPreview: (isPriority: boolean) =>
            gradcamUrl ? (
              <ArtifactImage
                src={gradcamUrl}
                alt={pick(locale, "Grad-CAM", "Grad-CAM")}
                className={previewClass}
                priority={isPriority ? "eager" : "lazy"}
              />
            ) : null,
        },
        {
          key: "roi_crop",
          enabled: Boolean(roiCropUrl),
          title: pick(locale, "Cornea crop", "각막 crop"),
          subtitle: pick(locale, "Cornea-focused crop", "각막 중심 crop"),
          renderPreview: (isPriority: boolean) =>
            roiCropUrl ? (
              <ArtifactImage
                src={roiCropUrl}
                alt={pick(locale, "Cornea crop", "각막 crop")}
                className={previewClass}
                priority={isPriority ? "eager" : "lazy"}
              />
            ) : null,
        },
        {
          key: "medsam_mask",
          enabled: Boolean(medsamMaskUrl),
          title: pick(locale, "Cornea mask", "각막 mask"),
          subtitle: pick(locale, "Cornea segmentation", "각막 분할"),
          renderPreview: () =>
            medsamMaskUrl ? (
              <MaskOverlayPreview
                sourceUrl={representativePreviewUrl}
                maskUrl={medsamMaskUrl}
                alt={pick(locale, "Cornea mask overlay", "각막 mask 오버레이")}
                tint={[231, 211, 111]}
              />
            ) : null,
        },
        {
          key: "lesion_crop",
          enabled: Boolean(lesionCropUrl),
          title: pick(locale, "Lesion crop", "병변 crop"),
          subtitle: pick(locale, "Lesion-centered crop", "병변 중심 crop"),
          renderPreview: (isPriority: boolean) =>
            lesionCropUrl ? (
              <ArtifactImage
                src={lesionCropUrl}
                alt={pick(locale, "Lesion crop", "병변 crop")}
                className={previewClass}
                priority={isPriority ? "eager" : "lazy"}
              />
            ) : null,
        },
        {
          key: "lesion_mask",
          enabled: Boolean(lesionMaskUrl),
          title: pick(locale, "Lesion mask", "병변 mask"),
          subtitle: pick(locale, "Lesion segmentation", "병변 분할"),
          renderPreview: () =>
            lesionMaskUrl ? (
              <MaskOverlayPreview
                sourceUrl={representativePreviewUrl}
                maskUrl={lesionMaskUrl}
                alt={pick(locale, "Lesion mask overlay", "병변 mask 오버레이")}
                tint={[242, 164, 154]}
              />
            ) : null,
        },
        {
          key: "gradcam_cornea",
          enabled: Boolean(gradcamCorneaUrl),
          title: pick(locale, "Cornea Grad-CAM", "각막 Grad-CAM"),
          subtitle: pick(locale, "Context branch attention", "문맥 branch attention"),
          renderPreview: (isPriority: boolean) =>
            gradcamCorneaUrl ? (
              <ArtifactImage
                src={gradcamCorneaUrl}
                alt={pick(locale, "Cornea branch Grad-CAM", "각막 branch Grad-CAM")}
                className={previewClass}
                priority={isPriority ? "eager" : "lazy"}
              />
            ) : null,
        },
        {
          key: "gradcam_lesion",
          enabled: Boolean(gradcamLesionUrl),
          title: pick(locale, "Lesion Grad-CAM", "병변 Grad-CAM"),
          subtitle: pick(locale, "Lesion-detail branch attention", "병변 세부 branch attention"),
          renderPreview: (isPriority: boolean) =>
            gradcamLesionUrl ? (
              <ArtifactImage
                src={gradcamLesionUrl}
                alt={pick(locale, "Lesion branch Grad-CAM", "병변 branch Grad-CAM")}
                className={previewClass}
                priority={isPriority ? "eager" : "lazy"}
              />
            ) : null,
        },
      ].filter((item) => item.enabled),
    [
      compact,
      gradcamCorneaUrl,
      gradcamLesionUrl,
      gradcamUrl,
      lesionCropUrl,
      lesionMaskUrl,
      locale,
      medsamMaskUrl,
      previewClass,
      representativePreviewUrl,
      roiCropUrl,
    ],
  );
  const fullArtifacts = useMemo<ReviewArtifact[]>(
    () =>
      compact
        ? []
        : [
            {
              key: "roi_crop",
              enabled: Boolean(roiCropUrl),
              title: pick(locale, "Cornea crop", "각막 crop"),
              subtitle: pick(locale, "Cornea-focused crop", "각막 중심 crop"),
              priority: "eager" as const,
              renderPreview: () =>
                roiCropUrl ? (
                  <ArtifactImage
                    src={roiCropUrl}
                    alt={pick(locale, "Cornea crop", "각막 crop")}
                    className={panelImagePreviewClass}
                    priority="eager"
                  />
                ) : null,
            },
            {
              key: "gradcam",
              enabled: Boolean(gradcamUrl && !gradcamCorneaUrl && !gradcamLesionUrl),
              title: pick(locale, "Grad-CAM", "Grad-CAM"),
              subtitle: pick(locale, "Model evidence overlay", "모델 근거 오버레이"),
              priority: "eager" as const,
              renderPreview: () =>
                gradcamUrl ? (
                  <ArtifactImage
                    src={gradcamUrl}
                    alt={pick(locale, "Grad-CAM", "Grad-CAM")}
                    className={panelImagePreviewClass}
                    priority="eager"
                  />
                ) : null,
            },
            {
              key: "gradcam_cornea",
              enabled: Boolean(gradcamCorneaUrl),
              title: pick(locale, "Cornea Grad-CAM", "각막 Grad-CAM"),
              subtitle: pick(locale, "Context branch attention", "문맥 branch attention"),
              priority: "eager" as const,
              renderPreview: () =>
                gradcamCorneaUrl ? (
                  <ArtifactImage
                    src={gradcamCorneaUrl}
                    alt={pick(locale, "Cornea branch Grad-CAM", "각막 branch Grad-CAM")}
                    className={panelImagePreviewClass}
                    priority="eager"
                  />
                ) : null,
            },
            {
              key: "gradcam_lesion",
              enabled: Boolean(gradcamLesionUrl),
              title: pick(locale, "Lesion Grad-CAM", "병변 Grad-CAM"),
              subtitle: pick(locale, "Lesion-detail branch attention", "병변 세부 branch attention"),
              priority: "eager" as const,
              renderPreview: () =>
                gradcamLesionUrl ? (
                  <ArtifactImage
                    src={gradcamLesionUrl}
                    alt={pick(locale, "Lesion branch Grad-CAM", "병변 branch Grad-CAM")}
                    className={panelImagePreviewClass}
                    priority="eager"
                  />
                ) : null,
            },
            {
              key: "medsam_mask",
              enabled: Boolean(medsamMaskUrl),
              title: pick(locale, "Cornea mask", "각막 mask"),
              subtitle: pick(locale, "Cornea segmentation", "각막 분할"),
              priority: "lazy" as const,
              renderPreview: () =>
                medsamMaskUrl ? (
                  <MaskOverlayPreview
                    sourceUrl={representativePreviewUrl}
                    maskUrl={medsamMaskUrl}
                    alt={pick(locale, "Cornea mask overlay", "각막 mask 오버레이")}
                    tint={[231, 211, 111]}
                  />
                ) : null,
            },
            {
              key: "lesion_crop",
              enabled: Boolean(lesionCropUrl),
              title: pick(locale, "Lesion crop", "병변 crop"),
              subtitle: pick(locale, "Lesion-centered crop", "병변 중심 crop"),
              priority: "lazy" as const,
              renderPreview: () =>
                lesionCropUrl ? (
                  <ArtifactImage
                    src={lesionCropUrl}
                    alt={pick(locale, "Lesion crop", "병변 crop")}
                    className={panelImagePreviewClass}
                    priority="lazy"
                  />
                ) : null,
            },
            {
              key: "lesion_mask",
              enabled: Boolean(lesionMaskUrl),
              title: pick(locale, "Lesion mask", "병변 mask"),
              subtitle: pick(locale, "Lesion segmentation", "병변 분할"),
              priority: "lazy" as const,
              renderPreview: () =>
                lesionMaskUrl ? (
                  <MaskOverlayPreview
                    sourceUrl={representativePreviewUrl}
                    maskUrl={lesionMaskUrl}
                    alt={pick(locale, "Lesion mask overlay", "병변 mask 오버레이")}
                    tint={[242, 164, 154]}
                  />
                ) : null,
            },
          ].filter((artifact) => artifact.enabled),
    [
      compact,
      gradcamCorneaUrl,
      gradcamLesionUrl,
      gradcamUrl,
      lesionCropUrl,
      lesionMaskUrl,
      locale,
      medsamMaskUrl,
      representativePreviewUrl,
      roiCropUrl,
    ],
  );
  const compactArtifactSignature = useMemo(
    () => compactArtifacts.map((artifact) => artifact.key).join("|"),
    [compactArtifacts],
  );
  const fullArtifactSignature = useMemo(
    () => fullArtifacts.map((artifact) => artifact.key).join("|"),
    [fullArtifacts],
  );
  const stagedCompactArtifactCount = useStagedRevealCount({
    totalCount: compactArtifacts.length,
    initialCount: compact ? 1 : 0,
    delayMs: 140,
    resetKey: compact ? compactArtifactSignature : "full",
  });
  const stagedFullArtifactCount = useStagedRevealCount({
    totalCount: fullArtifacts.length,
    initialCount: compact ? 0 : 2,
    delayMs: 160,
    resetKey: compact ? "compact" : fullArtifactSignature,
  });

  const visibleCompactArtifacts = compact
    ? compactArtifacts.slice(0, stagedCompactArtifactCount)
    : [];
  const visibleFullArtifacts = compact
    ? []
    : fullArtifacts.slice(0, stagedFullArtifactCount);

  return (
    <div className={stackClass}>
      {compact && visibleCompactArtifacts.length > 0 ? (
        visibleCompactArtifacts.map((artifact) => (
          <div
            key={artifact.key}
            className={cardClass}
            style={{ contentVisibility: "auto", containIntrinsicSize: "280px" }}
          >
            {artifact.renderPreview(artifact.key === visibleCompactArtifacts[0]?.key)}
            <div className={copyClass}>
              <strong>{artifact.title}</strong>
              <span>{artifact.subtitle}</span>
            </div>
          </div>
        ))
      ) : null}
      {!compact
        ? visibleFullArtifacts.map((artifact) => (
            <div key={artifact.key} className={panelImageCardClass}>
              <div style={{ contentVisibility: "auto", containIntrinsicSize: "360px" }}>
                {artifact.renderPreview()}
                <div className={panelImageCopyClass}>
                  <strong>{artifact.title}</strong>
                  <span>{artifact.subtitle}</span>
                </div>
              </div>
            </div>
          ))
        : null}
      {!roiCropUrl && !gradcamUrl && !gradcamCorneaUrl && !gradcamLesionUrl && !medsamMaskUrl && !lesionCropUrl && !lesionMaskUrl ? (
        <div className={panelImageFallbackClass}>
          {emptyMessage ??
            pick(
              locale,
              "No validation artifacts were produced for this run.",
              "이 실행에서는 검증 아티팩트가 생성되지 않았습니다.",
            )}
        </div>
      ) : null}
    </div>
  );
}

export const ValidationArtifactStack = memo(ValidationArtifactStackInner);
