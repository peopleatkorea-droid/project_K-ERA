"use client";

import { useEffect, useRef, useState } from "react";

import { pick, type Locale } from "../../lib/i18n";

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Unable to load image: ${src}`));
    image.src = src;
  });
}

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
    return <div className="panel-image-fallback">{alt}</div>;
  }

  return (
    <>
      <canvas
        ref={canvasRef}
        className={`panel-image-preview panel-image-overlay${overlayReady ? " ready" : ""}`}
        aria-label={alt}
      />
      {!overlayReady ? <img src={sourceUrl} alt={alt} className="panel-image-preview panel-image-overlay-fallback" /> : null}
    </>
  );
}

type Props = {
  locale: Locale;
  representativePreviewUrl: string | null | undefined;
  roiCropUrl: string | null | undefined;
  gradcamUrl: string | null | undefined;
  medsamMaskUrl: string | null | undefined;
  lesionCropUrl: string | null | undefined;
  lesionMaskUrl: string | null | undefined;
};

export function ValidationArtifactStack({
  locale,
  representativePreviewUrl,
  roiCropUrl,
  gradcamUrl,
  medsamMaskUrl,
  lesionCropUrl,
  lesionMaskUrl,
}: Props) {
  return (
    <div className="panel-image-stack">
      {roiCropUrl ? (
        <div className="panel-image-card">
          <img src={roiCropUrl} alt={pick(locale, "Cornea crop", "각막 crop")} className="panel-image-preview" />
          <div className="panel-image-copy">
            <strong>{pick(locale, "Cornea crop", "각막 crop")}</strong>
            <span>{pick(locale, "Cornea-focused crop", "각막 중심 crop")}</span>
          </div>
        </div>
      ) : null}
      {gradcamUrl ? (
        <div className="panel-image-card">
          <img src={gradcamUrl} alt={pick(locale, "Grad-CAM", "Grad-CAM")} className="panel-image-preview" />
          <div className="panel-image-copy">
            <strong>{pick(locale, "Grad-CAM", "Grad-CAM")}</strong>
            <span>{pick(locale, "Model evidence overlay", "모델 근거 오버레이")}</span>
          </div>
        </div>
      ) : null}
      {medsamMaskUrl ? (
        <div className="panel-image-card">
          <MaskOverlayPreview
            sourceUrl={representativePreviewUrl}
            maskUrl={medsamMaskUrl}
            alt={pick(locale, "Cornea mask overlay", "각막 mask 오버레이")}
            tint={[231, 211, 111]}
          />
          <div className="panel-image-copy">
            <strong>{pick(locale, "Cornea mask", "각막 mask")}</strong>
            <span>{pick(locale, "Cornea segmentation", "각막 분할")}</span>
          </div>
        </div>
      ) : null}
      {lesionCropUrl ? (
        <div className="panel-image-card">
          <img src={lesionCropUrl} alt={pick(locale, "Lesion crop", "병변 crop")} className="panel-image-preview" />
          <div className="panel-image-copy">
            <strong>{pick(locale, "Lesion crop", "병변 crop")}</strong>
            <span>{pick(locale, "Lesion-centered crop", "병변 중심 crop")}</span>
          </div>
        </div>
      ) : null}
      {lesionMaskUrl ? (
        <div className="panel-image-card">
          <MaskOverlayPreview
            sourceUrl={representativePreviewUrl}
            maskUrl={lesionMaskUrl}
            alt={pick(locale, "Lesion mask overlay", "병변 mask 오버레이")}
            tint={[242, 164, 154]}
          />
          <div className="panel-image-copy">
            <strong>{pick(locale, "Lesion mask", "병변 mask")}</strong>
            <span>{pick(locale, "Lesion segmentation", "병변 분할")}</span>
          </div>
        </div>
      ) : null}
      {!roiCropUrl && !gradcamUrl && !medsamMaskUrl && !lesionCropUrl && !lesionMaskUrl ? (
        <div className="panel-image-fallback">
          {pick(locale, "No validation artifacts were produced for this run.", "이 실행에서는 검증 아티팩트가 생성되지 않았습니다.")}
        </div>
      ) : null}
    </div>
  );
}
