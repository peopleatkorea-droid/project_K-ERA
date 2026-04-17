"use client";

import { memo, useEffect, useRef, useState } from "react";

import { pick, type Locale } from "../../lib/i18n";
import { drawCachedMaskOverlay } from "./mask-overlay-renderer";
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

  useEffect(() => {
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
      <canvas ref={canvasRef} className={panelImageOverlayClass(overlayReady)} aria-label={alt} />
      {!overlayReady ? <img src={sourceUrl} alt={alt} decoding="async" className={panelImageOverlayFallbackClass(overlayReady)} /> : null}
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
  const artifacts = compact
    ? [
        {
          key: "gradcam",
          enabled: Boolean(gradcamUrl && !gradcamCorneaUrl && !gradcamLesionUrl),
          title: pick(locale, "Grad-CAM", "Grad-CAM"),
          subtitle: pick(locale, "Model evidence overlay", "모델 근거 오버레이"),
          content: gradcamUrl ? (
            <img src={gradcamUrl} alt={pick(locale, "Grad-CAM", "Grad-CAM")} className={previewClass} loading="lazy" decoding="async" />
          ) : null,
        },
        {
          key: "roi_crop",
          enabled: Boolean(roiCropUrl),
          title: pick(locale, "Cornea crop", "각막 crop"),
          subtitle: pick(locale, "Cornea-focused crop", "각막 중심 crop"),
          content: roiCropUrl ? (
            <img src={roiCropUrl} alt={pick(locale, "Cornea crop", "각막 crop")} className={previewClass} loading="lazy" decoding="async" />
          ) : null,
        },
        {
          key: "medsam_mask",
          enabled: Boolean(medsamMaskUrl),
          title: pick(locale, "Cornea mask", "각막 mask"),
          subtitle: pick(locale, "Cornea segmentation", "각막 분할"),
          content: medsamMaskUrl ? (
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
          content: lesionCropUrl ? (
            <img src={lesionCropUrl} alt={pick(locale, "Lesion crop", "병변 crop")} className={previewClass} loading="lazy" decoding="async" />
          ) : null,
        },
        {
          key: "lesion_mask",
          enabled: Boolean(lesionMaskUrl),
          title: pick(locale, "Lesion mask", "병변 mask"),
          subtitle: pick(locale, "Lesion segmentation", "병변 분할"),
          content: lesionMaskUrl ? (
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
          content: gradcamCorneaUrl ? (
            <img
              src={gradcamCorneaUrl}
              alt={pick(locale, "Cornea branch Grad-CAM", "각막 branch Grad-CAM")}
              className={previewClass}
              loading="lazy"
              decoding="async"
            />
          ) : null,
        },
        {
          key: "gradcam_lesion",
          enabled: Boolean(gradcamLesionUrl),
          title: pick(locale, "Lesion Grad-CAM", "병변 Grad-CAM"),
          subtitle: pick(locale, "Lesion-detail branch attention", "병변 세부 branch attention"),
          content: gradcamLesionUrl ? (
            <img
              src={gradcamLesionUrl}
              alt={pick(locale, "Lesion branch Grad-CAM", "병변 branch Grad-CAM")}
              className={previewClass}
              loading="lazy"
              decoding="async"
            />
          ) : null,
        },
      ].filter((item) => item.enabled)
    : null;

  return (
    <div className={stackClass}>
      {compact && artifacts ? (
        artifacts.map((artifact) => (
          <div key={artifact.key} className={cardClass}>
            {artifact.content}
            <div className={copyClass}>
              <strong>{artifact.title}</strong>
              <span>{artifact.subtitle}</span>
            </div>
          </div>
        ))
      ) : null}
      {!compact && roiCropUrl ? (
        <div className={panelImageCardClass}>
          <img src={roiCropUrl} alt={pick(locale, "Cornea crop", "각막 crop")} className={panelImagePreviewClass} loading="lazy" decoding="async" />
          <div className={panelImageCopyClass}>
            <strong>{pick(locale, "Cornea crop", "각막 crop")}</strong>
            <span>{pick(locale, "Cornea-focused crop", "각막 중심 crop")}</span>
          </div>
        </div>
      ) : null}
      {!compact && gradcamUrl && !gradcamCorneaUrl && !gradcamLesionUrl ? (
        <div className={panelImageCardClass}>
          <img src={gradcamUrl} alt={pick(locale, "Grad-CAM", "Grad-CAM")} className={panelImagePreviewClass} loading="lazy" decoding="async" />
          <div className={panelImageCopyClass}>
            <strong>{pick(locale, "Grad-CAM", "Grad-CAM")}</strong>
            <span>{pick(locale, "Model evidence overlay", "모델 근거 오버레이")}</span>
          </div>
        </div>
      ) : null}
      {!compact && gradcamCorneaUrl ? (
        <div className={panelImageCardClass}>
          <img
            src={gradcamCorneaUrl}
            alt={pick(locale, "Cornea branch Grad-CAM", "각막 branch Grad-CAM")}
            className={panelImagePreviewClass}
            loading="lazy"
            decoding="async"
          />
          <div className={panelImageCopyClass}>
            <strong>{pick(locale, "Cornea Grad-CAM", "각막 Grad-CAM")}</strong>
            <span>{pick(locale, "Context branch attention", "문맥 branch attention")}</span>
          </div>
        </div>
      ) : null}
      {!compact && gradcamLesionUrl ? (
        <div className={panelImageCardClass}>
          <img
            src={gradcamLesionUrl}
            alt={pick(locale, "Lesion branch Grad-CAM", "병변 branch Grad-CAM")}
            className={panelImagePreviewClass}
            loading="lazy"
            decoding="async"
          />
          <div className={panelImageCopyClass}>
            <strong>{pick(locale, "Lesion Grad-CAM", "병변 Grad-CAM")}</strong>
            <span>{pick(locale, "Lesion-detail branch attention", "병변 세부 branch attention")}</span>
          </div>
        </div>
      ) : null}
      {!compact && medsamMaskUrl ? (
        <div className={panelImageCardClass}>
          <MaskOverlayPreview
            sourceUrl={representativePreviewUrl}
            maskUrl={medsamMaskUrl}
            alt={pick(locale, "Cornea mask overlay", "각막 mask 오버레이")}
            tint={[231, 211, 111]}
          />
          <div className={panelImageCopyClass}>
            <strong>{pick(locale, "Cornea mask", "각막 mask")}</strong>
            <span>{pick(locale, "Cornea segmentation", "각막 분할")}</span>
          </div>
        </div>
      ) : null}
      {!compact && lesionCropUrl ? (
        <div className={panelImageCardClass}>
          <img src={lesionCropUrl} alt={pick(locale, "Lesion crop", "병변 crop")} className={panelImagePreviewClass} loading="lazy" decoding="async" />
          <div className={panelImageCopyClass}>
            <strong>{pick(locale, "Lesion crop", "병변 crop")}</strong>
            <span>{pick(locale, "Lesion-centered crop", "병변 중심 crop")}</span>
          </div>
        </div>
      ) : null}
      {!compact && lesionMaskUrl ? (
        <div className={panelImageCardClass}>
          <MaskOverlayPreview
            sourceUrl={representativePreviewUrl}
            maskUrl={lesionMaskUrl}
            alt={pick(locale, "Lesion mask overlay", "병변 mask 오버레이")}
            tint={[242, 164, 154]}
          />
          <div className={panelImageCopyClass}>
            <strong>{pick(locale, "Lesion mask", "병변 mask")}</strong>
            <span>{pick(locale, "Lesion segmentation", "병변 분할")}</span>
          </div>
        </div>
      ) : null}
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
