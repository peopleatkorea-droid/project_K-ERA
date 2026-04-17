"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { SectionHeader } from "../ui/section-header";
import { docSectionHeadClass } from "../ui/workspace-patterns";
import type {
  AiClinicResponse,
  AiClinicSimilarCaseRecord,
  CaseValidationCompareResponse,
  CaseValidationResponse,
} from "../../lib/api";
import { pick, translateOption, type Locale } from "../../lib/i18n";
import { canUseDesktopLocalApiTransport, requestDesktopLocalApiJson } from "../../lib/desktop-local-api";

type AiClinicSimilarCasePreview = AiClinicSimilarCaseRecord & {
  preview_url: string | null;
};

type AiClinicPreviewResponse = Omit<AiClinicResponse, "similar_cases"> & {
  similar_cases: AiClinicSimilarCasePreview[];
};

type ClusterNeighbor = {
  patient_id: string;
  visit_date: string;
  category: string;
  species: string;
  age: string;
  sex: string;
  distance: number;
};

type ClusterPositionResult = {
  html: string;
  neighbors: ClusterNeighbor[];
};

type Props = {
  locale: Locale;
  validationResult: CaseValidationResponse | null;
  modelCompareResult: CaseValidationCompareResponse | null;
  result: AiClinicPreviewResponse | null;
  activeView: "retrieval" | "cluster";
  aiClinicPreviewBusy: boolean;
  aiClinicExpandedBusy: boolean;
  canExpandAiClinic: boolean;
  onExpandAiClinic: () => void;
  notAvailableLabel: string;
  aiClinicTextUnavailableLabel: string;
  displayVisitReference: (visitReference: string) => string;
  formatSemanticScore: (value: number | null | undefined, emptyLabel?: string) => string;
  formatImageQualityScore: (value: number | null | undefined, emptyLabel?: string) => string;
  formatProbability: (value: number | null | undefined, emptyLabel?: string) => string;
  formatMetadataField: (field: string) => string;
  token: string;
  siteId?: string | null;
};

type FieldItem = {
  label: string;
  value: ReactNode;
};

type FieldGridProps = {
  items: FieldItem[];
  columns?: 1 | 2 | 3 | 4;
};

function FieldGrid({ items, columns = 2 }: FieldGridProps) {
  const visibleItems = items.filter((item) => item.value !== null && item.value !== undefined && item.value !== "");
  if (visibleItems.length === 0) {
    return null;
  }
  const columnsClass =
    columns === 1
      ? "grid-cols-1"
      : columns === 2
        ? "sm:grid-cols-2"
        : columns === 3
          ? "sm:grid-cols-2 xl:grid-cols-3"
          : "sm:grid-cols-2 xl:grid-cols-4";
  return (
    <div className={`grid gap-3 ${columnsClass}`}>
      {visibleItems.map((item) => (
        <div key={String(item.label)} className="min-w-0 rounded-[18px] border border-border bg-surface px-4 py-3">
          <span className="block min-w-0 text-[0.78rem] font-medium leading-5 text-muted break-keep">{item.label}</span>
          <strong className="mt-1 block min-w-0 text-[0.98rem] font-semibold leading-6 text-ink break-words">
            {item.value}
          </strong>
        </div>
      ))}
    </div>
  );
}

function resolvePreviewImageSrc(previewUrl: string | null | undefined, _token: string) {
  const normalized = String(previewUrl || "").trim();
  if (!normalized) {
    return undefined;
  }
  if (normalized.startsWith("data:")) {
    return normalized;
  }
  return normalized;
}

function workflowRecommendationSubtitle(
  locale: Locale,
  recommendation: AiClinicPreviewResponse["workflow_recommendation"],
) {
  if (!recommendation) {
    return undefined;
  }
  const mode = String(recommendation.mode || "").trim().toLowerCase();
  if (mode === "local_fallback") {
    return pick(locale, "Local workflow guidance", "로컬 워크플로 가이드");
  }
  if (mode === "control_plane_relay") {
    return pick(locale, "Relay workflow guidance", "릴레이 워크플로 가이드");
  }
  if (mode === "openai") {
    return pick(locale, "LLM workflow guidance", "LLM 워크플로 가이드");
  }
  return recommendation.provider_label ?? recommendation.mode;
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <Card as="section" variant="nested" className="grid gap-4 p-5">
      <SectionHeader title={title} titleAs="h4" description={subtitle} className={docSectionHeadClass} />
      {children}
    </Card>
  );
}

function KpiCard({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-[18px] border border-border bg-surface px-4 py-3">
      <strong className="block text-lg font-semibold tracking-[-0.03em] text-ink">{value}</strong>
      <span className="mt-1 block text-sm text-muted">{label}</span>
    </div>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex min-h-9 items-center rounded-full border border-border bg-surface px-3 text-xs font-semibold text-ink">
      {children}
    </span>
  );
}

function Message({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[18px] border border-border bg-surface px-4 py-3 text-sm leading-6 text-muted">
      {children}
    </div>
  );
}

function BulletList({ items }: { items: string[] }) {
  const visibleItems = items
    .map((item) => String(item || "").trim())
    .filter((item) => item.length > 0);
  if (visibleItems.length === 0) {
    return null;
  }
  return (
    <ul className="grid gap-2 text-sm leading-6 text-muted">
      {visibleItems.map((item, index) => (
        <li key={`${item}-${index}`} className="rounded-[16px] border border-border bg-surface px-4 py-3">
          {item}
        </li>
      ))}
    </ul>
  );
}

function compactText(value: string | null | undefined, fallback: string, maxLength = 180) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return fallback;
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function joinValues(values: string[] | undefined, fallback: string) {
  return values && values.length > 0 ? values.join(" / ") : fallback;
}

function buildReadySummary(
  validationResult: CaseValidationResponse | null,
  modelCompareResult: CaseValidationCompareResponse | null,
) {
  if (!validationResult) {
    return null;
  }
  const successfulComparisons = (modelCompareResult?.comparisons ?? []).filter(
    (item) => !item.error && item.summary?.predicted_label
  );
  const comparedLabels = successfulComparisons
    .map((item) => String(item.summary?.predicted_label || "").trim())
    .filter((item) => item.length > 0);
  const anchorLabel = String(validationResult.summary.predicted_label || "").trim() || null;
  const successfulModelCount = comparedLabels.length > 0 ? comparedLabels.length : 1;
  const agreementCount = anchorLabel
    ? comparedLabels.length > 0
      ? comparedLabels.filter((item) => item === anchorLabel).length
      : 1
    : 0;
  return {
    anchorLabel,
    anchorModelName:
      validationResult.model_version.version_name ||
      validationResult.summary.model_version ||
      validationResult.model_version.architecture ||
      null,
    successfulModelCount,
    agreementCount,
    disagreementCount: Math.max(0, successfulModelCount - agreementCount),
    predictionProbability: validationResult.summary.prediction_probability,
  };
}

function AiClinicResultInner({
  locale,
  validationResult,
  modelCompareResult,
  result,
  activeView,
  aiClinicPreviewBusy,
  aiClinicExpandedBusy,
  canExpandAiClinic,
  onExpandAiClinic,
  notAvailableLabel,
  aiClinicTextUnavailableLabel,
  displayVisitReference,
  formatSemanticScore,
  formatImageQualityScore,
  formatProbability,
  formatMetadataField,
  token,
  siteId = null,
}: Props) {
  const readySummary = useMemo(
    () => buildReadySummary(validationResult, modelCompareResult),
    [validationResult, modelCompareResult],
  );
  const inferenceOnlyValidation =
    String(validationResult?.summary.validation_mode || "")
      .trim()
      .toLowerCase() === "inference_only";

  const [clusterResult, setClusterResult] = useState<ClusterPositionResult | null>(null);
  const [clusterLoading, setClusterLoading] = useState(false);
  const [clusterError, setClusterError] = useState<string | null>(null);
  const clusterLoadedForRef = useRef<string | null>(null);
  const similarPatientsSectionRef = useRef<HTMLDivElement | null>(null);
  const clusterSectionRef = useRef<HTMLDivElement | null>(null);
  const scrollSignatureRef = useRef<string | null>(null);

  const loadClusterPosition = useCallback(async (patientId: string, visitDate: string) => {
    if (!siteId || clusterLoading) return;
    const key = `${patientId}|${visitDate}`;
    if (clusterLoadedForRef.current === key) return;
    setClusterLoading(true);
    setClusterError(null);
    try {
      const params = new URLSearchParams({ patient_id: patientId, visit_date: visitDate });
      const path = `/api/sites/${siteId}/cluster-position?${params.toString()}`;
      let data: ClusterPositionResult;
      if (canUseDesktopLocalApiTransport()) {
        data = await requestDesktopLocalApiJson<ClusterPositionResult>(path, token, { method: "POST" });
      } else {
        const res = await fetch(path, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { detail?: string };
          throw new Error(err.detail ?? `Error: ${res.status}`);
        }
        data = await res.json() as ClusterPositionResult;
      }
      clusterLoadedForRef.current = key;
      setClusterResult(data);
    } catch (err: unknown) {
      setClusterError(err instanceof Error ? err.message : String(err));
    } finally {
      setClusterLoading(false);
    }
  }, [siteId, token, clusterLoading]);

  useEffect(() => {
    if (!result) {
      return;
    }
    const queryCase = result.query_case;
    const nextSignature = [
      activeView,
      result.analysis_stage,
      queryCase?.patient_id ?? "",
      queryCase?.visit_date ?? "",
    ].join("|");
    if (scrollSignatureRef.current === nextSignature) {
      return;
    }
    scrollSignatureRef.current = nextSignature;
    const target =
      activeView === "cluster"
        ? clusterSectionRef.current
        : similarPatientsSectionRef.current;
    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [
    activeView,
    result?.analysis_stage,
    result?.query_case.patient_id,
    result?.query_case.visit_date,
  ]);

  useEffect(() => {
    if (
      activeView !== "cluster" ||
      !result ||
      !siteId ||
      clusterLoading ||
      clusterResult ||
      clusterError
    ) {
      return;
    }
    const queryCase = result.query_case;
    if (!queryCase?.patient_id || !queryCase?.visit_date) {
      return;
    }
    void loadClusterPosition(queryCase.patient_id, queryCase.visit_date);
  }, [
    activeView,
    result?.analysis_stage,
    clusterError,
    clusterLoading,
    clusterResult,
    loadClusterPosition,
    result?.query_case.patient_id,
    result?.query_case.visit_date,
    siteId,
  ]);

  if (!result) {
    return (
      <div className="grid gap-4">
        <Message>
          {pick(
            locale,
            'Step 3 is ready. First click "Run image retrieval". If you need more explanation after that, click "Load evidence & guidance".',
            '3단계 준비가 끝났습니다. 먼저 "이미지 검색 실행"을 누르고, 추가 설명이 필요할 때만 "근거와 가이드 불러오기"를 누르세요.'
          )}
        </Message>
        {readySummary ? (
          <Section title={pick(locale, "Step 3 ready", "3단계 준비 상태")}>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard
                label={pick(locale, "Anchor label", "Anchor 라벨")}
                value={
                  readySummary.anchorLabel
                    ? translateOption(locale, "cultureCategory", readySummary.anchorLabel)
                    : notAvailableLabel
                }
              />
              <KpiCard label={pick(locale, "Compared models", "비교 모델 수")} value={readySummary.successfulModelCount} />
              <KpiCard
                label={pick(locale, "Agreement", "일치 수")}
                value={`${readySummary.agreementCount} / ${readySummary.successfulModelCount}`}
              />
              <KpiCard
                label={pick(locale, "Anchor confidence", "Anchor confidence")}
                value={formatProbability(readySummary.predictionProbability, notAvailableLabel)}
              />
            </div>
            <FieldGrid
              items={[
                { label: pick(locale, "Anchor model", "Anchor 모델"), value: readySummary.anchorModelName ?? notAvailableLabel },
                { label: pick(locale, "Disagreement", "불일치 수"), value: String(readySummary.disagreementCount) },
              ]}
            />
          </Section>
        ) : null}
      </div>
    );
  }

  const isExpanded = result.analysis_stage === "expanded";
  const classification = result.classification_context;
  const queryCase = result.query_case;
  const narrativeUnavailable = result.text_retrieval_mode === "unavailable";

  return (
    <div className="grid gap-4">
      <Section
        title={pick(locale, "Image retrieval overview", "이미지 검색 개요")}
        subtitle={result.ai_clinic_profile?.label ?? pick(locale, "DINOv2 retrieval", "DINOv2 retrieval")}
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label={pick(locale, "retrieved cases", "검색 케이스")} value={result.similar_cases.length} />
          <KpiCard label={pick(locale, "eligible cases", "검색 가능 케이스")} value={result.eligible_candidate_count} />
          <KpiCard
            label={pick(locale, "anchor label", "기준 라벨")}
            value={
              classification?.predicted_label
                ? translateOption(locale, "cultureCategory", classification.predicted_label)
                : readySummary?.anchorLabel
                  ? translateOption(locale, "cultureCategory", readySummary.anchorLabel)
                  : notAvailableLabel
            }
          />
          <KpiCard
            label={pick(locale, "anchor confidence", "기준 신뢰도")}
            value={formatProbability(
              classification?.predicted_confidence ??
                classification?.prediction_probability ??
                readySummary?.predictionProbability,
              notAvailableLabel,
            )}
          />
        </div>
        <FieldGrid
          items={[
            { label: pick(locale, "Patient / visit", "환자 / 방문"), value: `${queryCase.patient_id} / ${displayVisitReference(queryCase.visit_date)}` },
            {
              label: pick(locale, "Context", "기본 정보"),
              value: `${translateOption(locale, "sex", queryCase.sex ?? "unknown")} / ${queryCase.age ?? notAvailableLabel} / ${translateOption(locale, "view", queryCase.representative_view ?? "white")}`,
            },
            {
              label: pick(locale, "Image quality", "이미지 품질"),
              value: `${pick(locale, "Q-score", "Q-score")} ${formatImageQualityScore(queryCase.quality_score, notAvailableLabel)}`,
            },
            {
              label: pick(locale, "Predisposing factors", "선행 인자"),
              value: joinValues(
                (queryCase.predisposing_factor ?? []).map((factor) => translateOption(locale, "predisposing", factor)),
                notAvailableLabel,
              ),
            },
            {
              label: pick(locale, "Image-level model", "이미지 레벨 모델"),
              value:
                classification?.model_version ??
                validationResult?.model_version.version_name ??
                readySummary?.anchorModelName ??
                notAvailableLabel,
            },
            {
              label: pick(locale, "Model agreement", "모델 일치"),
              value: readySummary ? `${readySummary.agreementCount} / ${readySummary.successfulModelCount}` : notAvailableLabel,
            },
          ]}
        />
        <Message>
          {result.ai_clinic_profile?.description ??
            pick(
              locale,
              "This step retrieves visually similar cases first, then adds text evidence and workflow guidance only when you expand it.",
              "이 단계는 먼저 시각적으로 비슷한 케이스를 찾고, 펼쳤을 때만 텍스트 근거와 워크플로 가이드를 더합니다.",
            )}
        </Message>
        {!isExpanded ? (
          <Message>
            {pick(
              locale,
              'Retrieved cases are ready. Open extra evidence only if the retrieved images alone are not enough.',
              "검색 결과는 준비됐습니다. 검색된 이미지들만으로 부족할 때만 추가 근거를 열어보세요.",
            )}
          </Message>
        ) : null}
        {siteId ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={clusterLoading}
              onClick={() =>
                void loadClusterPosition(queryCase.patient_id, queryCase.visit_date)
              }
            >
              {clusterLoading
                ? pick(
                    locale,
                    "Loading cluster position... (first time may take ~10s)",
                    "클러스터 위치 계산 중... (첫 번째는 ~10초 소요)",
                  )
                : pick(
                    locale,
                    "Show cluster position",
                    "클러스터에서 위치 보기",
                  )}
            </Button>
            {clusterResult ? (
              <span className="inline-flex min-h-9 items-center rounded-full border border-border bg-surface px-3 text-xs font-semibold text-ink">
                {pick(
                  locale,
                  "3D cluster view loaded below",
                  "아래에 3D 클러스터 뷰가 열려 있습니다",
                )}
              </span>
            ) : null}
          </div>
        ) : null}
      </Section>

      {siteId && (activeView === "cluster" || clusterLoading || clusterResult || clusterError) ? (
        <div ref={clusterSectionRef}>
          <Section
          title={pick(locale, "3D cluster map", "3D 클러스터 맵")}
          subtitle={pick(
            locale,
            "3D UMAP position of this visit within the site embedding space. Nearest neighbors exclude the same patient.",
            "전체 데이터셋 내 이 방문의 3D UMAP 위치입니다. 동일 환자는 제외한 가장 가까운 방문을 표시합니다.",
          )}
        >
          {!clusterResult && !clusterError ? (
            <Message>
              {pick(
                locale,
                'Use the "Show cluster position" button above to place this visit in the 3D embedding map.',
                '위의 "클러스터에서 위치 보기" 버튼을 누르면 이 방문을 3D 임베딩 맵에 배치합니다.',
              )}
            </Message>
          ) : clusterError ? (
            <div className="grid gap-3">
              <div className="rounded-[18px] border border-danger/25 bg-danger/6 px-4 py-3 text-sm text-danger">
                {clusterError}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => { setClusterError(null); clusterLoadedForRef.current = null; }}
                >
                  {pick(locale, "Retry", "다시 시도")}
                </Button>
              </div>
            </div>
          ) : clusterResult ? (
            <div className="grid gap-4">
              <Card variant="nested" className="overflow-hidden p-0">
                <iframe
                  srcDoc={clusterResult.html}
                  title={pick(locale, "Embedding cluster position", "임베딩 클러스터 위치")}
                  className="h-[540px] w-full border-0"
                  sandbox="allow-scripts"
                />
              </Card>
              {clusterResult.neighbors.length > 0 ? (
                <div className="grid gap-3">
                  <span className="text-sm font-semibold text-ink">
                    {pick(locale, "Nearest neighbors (no same-patient duplicates)", "최근접 방문 (동일 환자 제외)")}
                  </span>
                  {clusterResult.neighbors.map((n, i) => (
                    <Card key={`${n.patient_id}-${n.visit_date}`} as="article" variant="panel" className="p-3">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-sm font-semibold text-ink">
                          {pick(locale, `Neighbor ${i + 1}`, `이웃 ${i + 1}`)}
                        </span>
                        <span
                          className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold"
                          style={{
                            background: n.category.includes("bact") ? "#dbeafe" : n.category.includes("fung") ? "#ffedd5" : "#f1f5f9",
                            color: n.category.includes("bact") ? "#1d4ed8" : n.category.includes("fung") ? "#c2410c" : "#475569",
                          }}
                        >
                          {translateOption(locale, "cultureCategory", n.category)}
                        </span>
                      </div>
                      <FieldGrid
                        items={[
                          { label: pick(locale, "Species", "균주"), value: n.species || notAvailableLabel },
                          {
                            label: pick(locale, "Sex / Age", "성별 / 나이"),
                            value: `${translateOption(locale, "sex", n.sex || "unknown")} / ${n.age || notAvailableLabel}`,
                          },
                          { label: pick(locale, "Visit", "방문일"), value: displayVisitReference(n.visit_date) },
                          { label: pick(locale, "Cosine distance", "코사인 거리"), value: n.distance.toFixed(4) },
                        ]}
                      />
                    </Card>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          </Section>
        </div>
      ) : null}

      {activeView === "retrieval" ? (
        <div ref={similarPatientsSectionRef}>
          <Section
            title={pick(locale, "Top retrieved cases", "상위 검색 케이스")}
            subtitle={pick(locale, `${result.similar_cases.length} ranked results`, `${result.similar_cases.length}개 순위 결과`)}
          >
            {result.similar_cases.length === 0 ? (
              <Message>
                {pick(
                  locale,
                  "No eligible similar case was found for this model and crop setup yet.",
                  "현재 이 모델과 crop 설정 기준으로 검색 가능한 유사 케이스가 아직 없습니다.",
                )}
              </Message>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                {result.similar_cases.map((item, index) => (
                  <Card
                    key={`${item.patient_id}-${item.visit_date}`}
                    as="article"
                    variant="nested"
                    className="grid min-w-0 gap-3 border border-border/80 p-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="grid gap-1">
                        <strong className="text-sm font-semibold text-ink">
                          {pick(locale, `Case ${index + 1}`, `케이스 ${index + 1}`)}
                        </strong>
                        <span className="text-xs text-muted">
                          {displayVisitReference(item.visit_date)}
                        </span>
                      </div>
                      <Badge>{`${pick(locale, "Similarity", "유사도")} ${formatSemanticScore(item.similarity, notAvailableLabel)}`}</Badge>
                    </div>
                    {item.preview_url ? (
                      <Card as="div" variant="panel" className="overflow-hidden">
                        <img
                          src={resolvePreviewImageSrc(item.preview_url, token)}
                          alt={pick(locale, `${item.patient_id} representative image`, `${item.patient_id} 대표 이미지`)}
                          className="aspect-[4/3] w-full object-cover"
                          loading="lazy"
                          decoding="async"
                        />
                      </Card>
                    ) : (
                      <Message>
                        {aiClinicPreviewBusy && item.representative_image_id
                          ? pick(locale, "Loading representative image...", "대표 이미지를 불러오는 중입니다.")
                          : pick(locale, "Representative image preview is unavailable.", "대표 이미지 미리보기를 불러올 수 없습니다.")}
                      </Message>
                    )}
                    <FieldGrid
                      columns={2}
                      items={[
                        { label: pick(locale, "Patient / code", "환자 / 코드"), value: item.local_case_code || item.chart_alias || item.patient_id },
                        {
                          label: pick(locale, "Culture", "배양"),
                          value: `${translateOption(locale, "cultureCategory", item.culture_category)} / ${item.culture_species || notAvailableLabel}`,
                        },
                        {
                          label: pick(locale, "View / status", "View / 상태"),
                          value: `${translateOption(locale, "view", item.representative_view ?? "white")} / ${translateOption(locale, "visitStatus", item.visit_status ?? "active")}`,
                        },
                        {
                          label: pick(locale, "Image quality", "이미지 품질"),
                          value: formatImageQualityScore(item.quality_score, notAvailableLabel),
                        },
                      ]}
                    />
                    {item.metadata_reranking?.alignment ? (
                      <Message>
                        {pick(locale, "Matched", "일치")}:{" "}
                        {(item.metadata_reranking.alignment.matched_fields ?? []).length > 0
                          ? (item.metadata_reranking.alignment.matched_fields ?? []).map(formatMetadataField).join(", ")
                          : notAvailableLabel}
                        {" · "}
                        {pick(locale, "Conflict", "충돌")}:{" "}
                        {(item.metadata_reranking.alignment.conflicted_fields ?? []).length > 0
                          ? (item.metadata_reranking.alignment.conflicted_fields ?? []).map(formatMetadataField).join(", ")
                          : notAvailableLabel}
                      </Message>
                    ) : null}
                  </Card>
                ))}
              </div>
            )}
          </Section>
        </div>
      ) : null}

      {activeView === "retrieval" && !isExpanded ? (
        <Section title={pick(locale, "Optional evidence and guidance", "선택형 근거와 가이드")} subtitle={pick(locale, "Only when needed", "필요할 때만")}>
          <Message>
            {pick(
              locale,
              'Load this only when the similar-patient list alone is not enough and you want extra explanation or suggested next steps.',
              '유사 환자 목록만으로 부족하고 추가 설명이나 다음 단계 제안이 필요할 때만 이 단계를 불러오세요.'
            )}
          </Message>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" onClick={onExpandAiClinic} disabled={!canExpandAiClinic || aiClinicExpandedBusy}>
              {aiClinicExpandedBusy
                ? pick(locale, "Loading evidence and guidance...", "근거와 가이드 불러오는 중...")
                : pick(locale, "Load evidence & guidance", "근거와 가이드 불러오기")}
            </Button>
          </div>
        </Section>
      ) : null}

      {activeView === "retrieval" && narrativeUnavailable ? <Message>{aiClinicTextUnavailableLabel}</Message> : null}

      {activeView === "retrieval" && result.text_evidence.length > 0 ? (
        <Section title={pick(locale, "Retrieved text evidence", "검색된 텍스트 근거")}>
          <div className="grid gap-3 xl:grid-cols-2">
            {result.text_evidence.map((item, index) => (
              <Card key={`${item.patient_id}-${item.visit_date}-text`} as="article" variant="panel" className="grid gap-3 p-4">
                <SectionHeader
                  title={pick(locale, `Evidence ${index + 1}`, `근거 ${index + 1}`)}
                  titleAs="h4"
                  description={displayVisitReference(item.visit_date)}
                />
                <FieldGrid
                  items={[
                    { label: pick(locale, "Patient / code", "환자 / 코드"), value: item.local_case_code || item.chart_alias || item.patient_id },
                    { label: pick(locale, "Similarity", "유사도"), value: formatSemanticScore(item.similarity, notAvailableLabel) },
                  ]}
                />
                <p className="m-0 whitespace-pre-wrap text-sm leading-6 text-muted">{compactText(item.text, aiClinicTextUnavailableLabel, 220)}</p>
              </Card>
            ))}
          </div>
        </Section>
      ) : null}

      {activeView === "retrieval" && result.differential ? (
        <Section title={pick(locale, "Differential ranking", "감별 진단 순위")} subtitle={result.differential.engine}>
          <div className="grid gap-3 xl:grid-cols-3">
            {result.differential.differential.map((item, index) => (
              <Card key={`diff-${item.label}`} as="article" variant="panel" className="grid gap-3 p-4">
                <SectionHeader
                  title={`${index + 1}. ${translateOption(locale, "cultureCategory", item.label)}`}
                  titleAs="h4"
                  aside={<Badge>{item.confidence_band}</Badge>}
                />
                <FieldGrid
                  items={[
                    { label: pick(locale, "Score", "점수"), value: formatProbability(item.score, notAvailableLabel) },
                    { label: pick(locale, "Classifier", "분류기"), value: formatSemanticScore(item.component_scores.classifier, notAvailableLabel) },
                    { label: pick(locale, "Retrieval", "검색"), value: formatSemanticScore(item.component_scores.retrieval, notAvailableLabel) },
                    { label: pick(locale, "Text", "텍스트"), value: formatSemanticScore(item.component_scores.text, notAvailableLabel) },
                  ]}
                />
                {(item.supporting_evidence.length > 0 || item.conflicting_evidence.length > 0) ? (
                  <Message>
                    {pick(locale, "Support", "지지")}:{" "}
                    {item.supporting_evidence.length > 0 ? item.supporting_evidence.join(" / ") : notAvailableLabel}
                    {" · "}
                    {pick(locale, "Conflict", "상충")}:{" "}
                    {item.conflicting_evidence.length > 0 ? item.conflicting_evidence.join(" / ") : notAvailableLabel}
                  </Message>
                ) : null}
              </Card>
            ))}
          </div>
        </Section>
      ) : null}

      {activeView === "retrieval" && result.workflow_recommendation ? (
        <Section
          title={pick(locale, "Workflow recommendation", "workflow recommendation")}
          subtitle={workflowRecommendationSubtitle(locale, result.workflow_recommendation)}
        >
          <Message>{result.workflow_recommendation.summary}</Message>
          <div className="grid gap-4 xl:grid-cols-2">
            <div className="grid gap-3">
              <strong className="text-sm font-semibold text-ink">
                {pick(locale, "Recommended steps", "권장 단계")}
              </strong>
              <BulletList items={result.workflow_recommendation.recommended_steps} />
            </div>
            <div className="grid gap-3">
              <strong className="text-sm font-semibold text-ink">
                {pick(locale, "Flags to review", "검토 플래그")}
              </strong>
              <BulletList items={result.workflow_recommendation.flags_to_review} />
            </div>
          </div>
          <FieldGrid
            items={[
              { label: pick(locale, "Rationale", "근거"), value: result.workflow_recommendation.rationale },
              { label: pick(locale, "Uncertainty", "불확실성"), value: result.workflow_recommendation.uncertainty },
            ]}
          />
        </Section>
      ) : null}
    </div>
  );
}

export const AiClinicResult = memo(AiClinicResultInner);
