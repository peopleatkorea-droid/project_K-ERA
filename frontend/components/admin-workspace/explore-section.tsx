"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { SectionHeader } from "../ui/section-header";
import { docSectionLabelClass, emptySurfaceClass, segmentedToggleClass, togglePillClass } from "../ui/workspace-patterns";
import { canUseDesktopLocalApiTransport, requestDesktopLocalApiJson } from "../../lib/desktop-local-api";
import { pick, type Locale } from "../../lib/i18n";

type ClusterVizStatus = {
  exists: boolean;
  generated_at: string | null;
  size_bytes: number;
};

type ClusterConfig = {
  backbone: "official" | "ssl";
  crop_mode: "full" | "cornea_roi" | "lesion_crop";
  view_filter: "all" | "white" | "slit" | "fluorescein";
};

type ExploreSectionProps = {
  locale: Locale;
  token: string;
  selectedSiteId: string | null;
};

async function fetchClusterStatus(siteId: string, token: string): Promise<ClusterVizStatus> {
  const path = `/api/sites/${siteId}/explore/cluster-visualization/status`;
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopLocalApiJson<ClusterVizStatus>(path, token);
  }
  const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return { exists: false, generated_at: null, size_bytes: 0 };
  if (!res.ok) throw new Error(`Status check failed: ${res.status}`);
  return res.json() as Promise<ClusterVizStatus>;
}

async function fetchClusterHtml(siteId: string, token: string): Promise<string> {
  const path = `/api/sites/${siteId}/explore/cluster-visualization`;
  if (canUseDesktopLocalApiTransport()) {
    const payload = await requestDesktopLocalApiJson<{ html: string }>(path, token);
    return payload.html;
  }
  const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`HTML fetch failed: ${res.status}`);
  const payload = await res.json() as { html: string };
  return payload.html;
}

async function triggerRegenerate(siteId: string, token: string, config: ClusterConfig): Promise<void> {
  const query = new URLSearchParams({
    backbone: config.backbone,
    crop_mode: config.crop_mode,
    view_filter: config.view_filter,
  });
  const path = `/api/sites/${siteId}/explore/cluster-visualization/regenerate?${query.toString()}`;
  if (canUseDesktopLocalApiTransport()) {
    await requestDesktopLocalApiJson<ClusterVizStatus>(path, token, { method: "POST" });
    return;
  }
  const res = await fetch(path, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({})) as { detail?: string };
    throw new Error(payload.detail ?? `Regeneration failed: ${res.status}`);
  }
}

const DEFAULT_CONFIG: ClusterConfig = {
  backbone: "official",
  crop_mode: "full",
  view_filter: "all",
};

export function ExploreSection({ locale, token, selectedSiteId }: ExploreSectionProps) {
  const [config, setConfig] = useState<ClusterConfig>(DEFAULT_CONFIG);
  const [status, setStatus] = useState<ClusterVizStatus | null>(null);
  const [htmlContent, setHtmlContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!selectedSiteId) {
      setStatus(null);
      setHtmlContent(null);
      setError(null);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setHtmlContent(null);
    setError(null);

    fetchClusterStatus(selectedSiteId, token)
      .then(async (s) => {
        if (controller.signal.aborted) return;
        setStatus(s);
        if (s.exists) {
          const html = await fetchClusterHtml(selectedSiteId, token);
          if (!controller.signal.aborted) setHtmlContent(html);
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [selectedSiteId, token]);

  async function handleRegenerate() {
    if (!selectedSiteId || regenerating) return;
    setRegenerating(true);
    setError(null);
    try {
      await triggerRegenerate(selectedSiteId, token, config);
      const [html, newStatus] = await Promise.all([
        fetchClusterHtml(selectedSiteId, token),
        fetchClusterStatus(selectedSiteId, token),
      ]);
      setStatus(newStatus);
      setHtmlContent(html);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRegenerating(false);
    }
  }

  const generatedLabel = status?.generated_at
    ? new Date(status.generated_at).toLocaleString(locale === "ko" ? "ko-KR" : "en-US", {
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  const busy = regenerating || loading;

  return (
    <div className="grid gap-4">
      <SectionHeader
        eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Explore", "탐색")}</div>}
        title={pick(locale, "Embedding cluster visualization", "임베딩 클러스터 시각화")}
        titleAs="h3"
        description={pick(
          locale,
          "3D UMAP projection of DINOv2 visit-level embeddings. Rotate, zoom, and hover to explore case distribution across culture categories.",
          "DINOv2 방문 단위 임베딩의 3D UMAP 투영입니다. 회전·확대·hover로 균류/세균 분포를 탐색하세요.",
        )}
        aside={
          generatedLabel ? (
            <span className="text-sm text-muted">
              {pick(locale, "Generated", "생성")} {generatedLabel}
            </span>
          ) : null
        }
      />

      {/* Config controls */}
      {selectedSiteId ? (
        <Card variant="nested" className="grid gap-4 p-4">
          <div className="grid gap-3">
            {/* Backbone */}
            <div className="flex flex-wrap items-center gap-3">
              <span className="w-24 shrink-0 text-sm font-medium text-ink">
                {pick(locale, "Backbone", "백본")}
              </span>
              <div className={segmentedToggleClass} role="group">
                {(["official", "ssl"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={togglePillClass(config.backbone === v)}
                    onClick={() => setConfig((c) => ({ ...c, backbone: v }))}
                    disabled={busy}
                  >
                    {v === "official" ? pick(locale, "Official", "공식") : "SSL fine-tuned"}
                  </button>
                ))}
              </div>
            </div>

            {/* Crop mode */}
            <div className="flex flex-wrap items-center gap-3">
              <span className="w-24 shrink-0 text-sm font-medium text-ink">
                {pick(locale, "Crop", "크롭")}
              </span>
              <div className={segmentedToggleClass} role="group">
                {(["full", "cornea_roi", "lesion_crop"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={togglePillClass(config.crop_mode === v)}
                    onClick={() => setConfig((c) => ({ ...c, crop_mode: v }))}
                    disabled={busy}
                  >
                    {v === "full"
                      ? pick(locale, "Full frame", "전체")
                      : v === "cornea_roi"
                        ? pick(locale, "Cornea ROI", "각막 ROI")
                        : pick(locale, "Lesion crop", "병변 크롭")}
                  </button>
                ))}
              </div>
            </div>

            {/* View filter */}
            <div className="flex flex-wrap items-center gap-3">
              <span className="w-24 shrink-0 text-sm font-medium text-ink">
                {pick(locale, "View", "뷰")}
              </span>
              <div className={segmentedToggleClass} role="group">
                {(["all", "white", "slit", "fluorescein"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={togglePillClass(config.view_filter === v)}
                    onClick={() => setConfig((c) => ({ ...c, view_filter: v }))}
                    disabled={busy}
                  >
                    {v === "all"
                      ? pick(locale, "All views", "전체")
                      : v === "white"
                        ? pick(locale, "White light", "백색광")
                        : v === "slit"
                          ? pick(locale, "Slit", "세극등")
                          : pick(locale, "Fluorescein", "형광")}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <Button
            type="button"
            variant="primary"
            disabled={busy}
            onClick={() => void handleRegenerate()}
          >
            {regenerating
              ? pick(locale, "Generating... (this may take a minute)", "생성 중... (1분 내외 소요)")
              : pick(locale, "Generate", "생성")}
          </Button>
        </Card>
      ) : null}

      {error ? (
        <Card variant="nested" className="border-danger/25 bg-danger/6 px-4 py-3 text-sm text-danger">
          {error}
        </Card>
      ) : null}

      {!selectedSiteId ? (
        <Card variant="nested" className="p-4">
          <div className={emptySurfaceClass}>
            {pick(locale, "Select a hospital to view the cluster visualization.", "병원을 선택하면 클러스터 시각화가 표시됩니다.")}
          </div>
        </Card>
      ) : loading ? (
        <Card variant="nested" className="p-4">
          <div className={emptySurfaceClass}>
            {pick(locale, "Loading visualization...", "시각화를 불러오는 중...")}
          </div>
        </Card>
      ) : htmlContent ? (
        <Card variant="nested" className="overflow-hidden p-0">
          <iframe
            srcDoc={htmlContent}
            title={pick(locale, "Embedding cluster visualization", "임베딩 클러스터 시각화")}
            className="h-[800px] w-full border-0"
            sandbox="allow-scripts"
          />
        </Card>
      ) : (
        <Card variant="nested" className="p-4">
          <div className={emptySurfaceClass}>
            {pick(
              locale,
              "Configure the options above and click Generate to build the visualization.",
              "위에서 옵션을 선택하고 생성을 클릭하세요.",
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
