"use client";

import { memo, useMemo, type ReactNode } from "react";

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

type AiClinicSimilarCasePreview = AiClinicSimilarCaseRecord & {
  preview_url: string | null;
};

type AiClinicPreviewResponse = Omit<AiClinicResponse, "similar_cases"> & {
  similar_cases: AiClinicSimilarCasePreview[];
};

type Props = {
  locale: Locale;
  validationResult: CaseValidationResponse | null;
  modelCompareResult: CaseValidationCompareResponse | null;
  result: AiClinicPreviewResponse | null;
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
};

type FieldItem = {
  label: string;
  value: ReactNode;
};

function FieldGrid({ items }: { items: FieldItem[] }) {
  const visibleItems = items.filter((item) => item.value !== null && item.value !== undefined && item.value !== "");
  if (visibleItems.length === 0) {
    return null;
  }
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {visibleItems.map((item) => (
        <div key={String(item.label)} className="rounded-[18px] border border-border bg-surface px-4 py-3">
          <span className="block text-[0.82rem] text-muted">{item.label}</span>
          <strong className="mt-1 block text-sm leading-6 text-ink">{item.value}</strong>
        </div>
      ))}
    </div>
  );
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
}: Props) {
  const readySummary = useMemo(
    () => buildReadySummary(validationResult, modelCompareResult),
    [validationResult, modelCompareResult],
  );

  if (!result) {
    return (
      <div className="grid gap-4">
        <Message>
          {pick(
            locale,
            "AI Clinic is ready. Use the saved validation result as the anchor, pull similar cases first, then expand into narrative evidence only when needed.",
            "AI Clinic 준비가 끝났습니다. 저장된 validation 결과를 anchor로 쓰고, 먼저 유사 케이스를 불러온 뒤 필요할 때만 확장 근거를 추가로 불러옵니다."
          )}
        </Message>
        {readySummary ? (
          <Section title={pick(locale, "AI Clinic ready", "AI Clinic 준비 상태")}>
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
        title={pick(locale, "AI Clinic overview", "AI Clinic 개요")}
        subtitle={result.ai_clinic_profile?.label ?? pick(locale, "AI Clinic standard", "AI Clinic standard")}
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label={pick(locale, "similar patients", "유사 환자")} value={result.similar_cases.length} />
          <KpiCard label={pick(locale, "eligible cases", "검색 가능 케이스")} value={result.eligible_candidate_count} />
          <KpiCard
            label={isExpanded ? pick(locale, "text evidence", "텍스트 근거") : pick(locale, "compared models", "비교 모델 수")}
            value={isExpanded ? result.text_evidence.length : (readySummary?.successfulModelCount ?? 0)}
          />
          <KpiCard
            label={isExpanded ? pick(locale, "workflow steps", "workflow steps") : pick(locale, "agreement", "일치 수")}
            value={
              isExpanded
                ? (result.workflow_recommendation?.recommended_steps.length ?? 0)
                : readySummary
                  ? `${readySummary.agreementCount} / ${readySummary.successfulModelCount}`
                  : notAvailableLabel
            }
          />
        </div>
        <Message>
          {result.ai_clinic_profile?.description ??
            pick(
              locale,
              "AI Clinic combines similar-patient retrieval, narrative evidence, differential ranking, and workflow guidance in one review flow.",
              "AI Clinic은 유사 환자 검색, narrative evidence, differential ranking, workflow guidance를 하나의 review 흐름으로 묶습니다."
            )}
        </Message>
        {!isExpanded ? (
          <Message>
            {pick(
              locale,
              "Similar cases are ready. Load evidence only when you want narrative support, differential ranking, and workflow guidance.",
              "유사 케이스 검색은 준비됐습니다. narrative support, differential ranking, workflow guidance가 필요할 때만 확장 근거를 불러오세요."
            )}
          </Message>
        ) : null}
      </Section>

      <Section title={pick(locale, "Query context", "질의 케이스 컨텍스트")}>
        <FieldGrid
          items={[
            { label: pick(locale, "Patient / visit", "환자 / 방문"), value: `${queryCase.patient_id} / ${displayVisitReference(queryCase.visit_date)}` },
            { label: pick(locale, "Case ID", "케이스 ID"), value: queryCase.case_id },
            {
              label: pick(locale, "Demographics", "기본 정보"),
              value: `${translateOption(locale, "sex", queryCase.sex ?? "unknown")} / ${queryCase.age ?? notAvailableLabel}`,
            },
            {
              label: pick(locale, "Representative view", "대표 view"),
              value: translateOption(locale, "view", queryCase.representative_view ?? "white"),
            },
            {
              label: pick(locale, "Image quality", "이미지 품질"),
              value: `${pick(locale, "Q-score", "Q-score")} ${formatImageQualityScore(queryCase.quality_score, notAvailableLabel)}`,
            },
            {
              label: pick(locale, "Predisposing factors", "선행 인자"),
              value: joinValues(
                (queryCase.predisposing_factor ?? []).map((factor) => translateOption(locale, "predisposing", factor)),
                notAvailableLabel
              ),
            },
          ]}
        />
        {(classification || readySummary) ? (
          <FieldGrid
            items={[
              {
                label: pick(locale, "Validation model", "validation 모델"),
                value:
                  classification?.model_version ??
                  validationResult?.model_version.version_name ??
                  readySummary?.anchorModelName ??
                  notAvailableLabel,
              },
              {
                label: pick(locale, "Predicted label", "예측 라벨"),
                value:
                  classification?.predicted_label
                    ? translateOption(locale, "cultureCategory", classification.predicted_label)
                    : readySummary?.anchorLabel
                      ? translateOption(locale, "cultureCategory", readySummary.anchorLabel)
                      : notAvailableLabel,
              },
              {
                label: pick(locale, "Prediction probability", "예측 확률"),
                value: formatProbability(
                  classification?.prediction_probability ?? readySummary?.predictionProbability,
                  notAvailableLabel
                ),
              },
              {
                label: pick(locale, "Agreement", "일치 수"),
                value: readySummary ? `${readySummary.agreementCount} / ${readySummary.successfulModelCount}` : notAvailableLabel,
              },
            ]}
          />
        ) : null}
      </Section>

      <Section
        title={pick(locale, "Similar patients", "유사 환자")}
        subtitle={pick(locale, `${result.similar_cases.length} ranked results`, `${result.similar_cases.length}개 순위 결과`)}
      >
        {result.similar_cases.length === 0 ? (
          <Message>
            {pick(
              locale,
              "No eligible similar patient was found for this model and crop setup yet.",
              "현재 이 모델과 crop 설정 기준으로 검색 가능한 유사 환자가 아직 없습니다."
            )}
          </Message>
        ) : (
          <div className="grid gap-4">
            {result.similar_cases.map((item, index) => (
              <Card key={`${item.patient_id}-${item.visit_date}`} as="article" variant="nested" className="grid gap-4 border border-border/80 p-4">
                <SectionHeader
                  title={pick(locale, `Patient ${index + 1}`, `환자 ${index + 1}`)}
                  titleAs="h4"
                  description={displayVisitReference(item.visit_date)}
                  aside={<Badge>{`${pick(locale, "Similarity", "유사도")} ${formatSemanticScore(item.similarity, notAvailableLabel)}`}</Badge>}
                />
                <div className="grid gap-4 xl:grid-cols-[240px_minmax(0,1fr)]">
                  <div>
                    {item.preview_url ? (
                      <Card as="div" variant="panel" className="overflow-hidden">
                        <img
                          src={item.preview_url ? `${item.preview_url}${item.preview_url.includes("?") ? "&" : "?"}token=${token}` : undefined}
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
                  </div>
                  <div className="grid gap-4">
                    <FieldGrid
                      items={[
                        { label: pick(locale, "Patient / code", "환자 / 코드"), value: item.local_case_code || item.chart_alias || item.patient_id },
                        {
                          label: pick(locale, "Culture", "배양"),
                          value: `${translateOption(locale, "cultureCategory", item.culture_category)} / ${item.culture_species || notAvailableLabel}`,
                        },
                        {
                          label: pick(locale, "View / visit status", "View / 방문 상태"),
                          value: `${translateOption(locale, "view", item.representative_view ?? "white")} / ${translateOption(locale, "visitStatus", item.visit_status ?? "active")}`,
                        },
                        {
                          label: pick(locale, "Image quality", "이미지 품질"),
                          value: `${pick(locale, "Q-score", "Q-score")} ${formatImageQualityScore(item.quality_score, notAvailableLabel)}`,
                        },
                      ]}
                    />
                    {item.metadata_reranking?.alignment ? (
                      <FieldGrid
                        items={[
                          {
                            label: pick(locale, "Matched metadata", "일치 메타데이터"),
                            value:
                              (item.metadata_reranking.alignment.matched_fields ?? []).length > 0
                                ? (item.metadata_reranking.alignment.matched_fields ?? []).map(formatMetadataField).join(", ")
                                : notAvailableLabel,
                          },
                          {
                            label: pick(locale, "Conflicted metadata", "충돌 메타데이터"),
                            value:
                              (item.metadata_reranking.alignment.conflicted_fields ?? []).length > 0
                                ? (item.metadata_reranking.alignment.conflicted_fields ?? []).map(formatMetadataField).join(", ")
                                : notAvailableLabel,
                          },
                        ]}
                      />
                    ) : null}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Section>

      {!isExpanded ? (
        <Section title={pick(locale, "Expanded evidence", "확장 근거")} subtitle={pick(locale, "On demand", "필요할 때만")}>
          <Message>
            {pick(
              locale,
              "Load evidence when you want narrative retrieval, differential ranking, and workflow guidance on top of the similar-patient list.",
              "유사 환자 목록 위에 narrative retrieval, differential ranking, workflow guidance가 필요할 때만 확장 근거를 불러오세요."
            )}
          </Message>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="ghost" onClick={onExpandAiClinic} disabled={!canExpandAiClinic || aiClinicExpandedBusy}>
              {aiClinicExpandedBusy
                ? pick(locale, "Loading evidence...", "근거 불러오는 중...")
                : pick(locale, "Load evidence and workflow", "근거와 workflow 불러오기")}
            </Button>
          </div>
        </Section>
      ) : null}

      {narrativeUnavailable ? <Message>{aiClinicTextUnavailableLabel}</Message> : null}

      {result.text_evidence.length > 0 ? (
        <Section title={pick(locale, "Retrieved text evidence", "검색된 텍스트 근거")}>
          <div className="grid gap-3">
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
                <p className="m-0 whitespace-pre-wrap text-sm leading-6 text-muted">{item.text}</p>
              </Card>
            ))}
          </div>
        </Section>
      ) : null}

      {result.differential ? (
        <Section title={pick(locale, "Differential ranking", "감별 진단 순위")} subtitle={result.differential.engine}>
          <div className="grid gap-3">
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
                  <FieldGrid
                    items={[
                      {
                        label: pick(locale, "Supporting evidence", "지지 근거"),
                        value: item.supporting_evidence.length > 0 ? item.supporting_evidence.join(" / ") : notAvailableLabel,
                      },
                      {
                        label: pick(locale, "Conflicting evidence", "상충 근거"),
                        value: item.conflicting_evidence.length > 0 ? item.conflicting_evidence.join(" / ") : notAvailableLabel,
                      },
                    ]}
                  />
                ) : null}
              </Card>
            ))}
          </div>
        </Section>
      ) : null}

      {result.workflow_recommendation ? (
        <Section title={pick(locale, "Workflow recommendation", "workflow recommendation")} subtitle={result.workflow_recommendation.mode}>
          <Message>{result.workflow_recommendation.summary}</Message>
          <FieldGrid
            items={[
              { label: pick(locale, "Recommended steps", "권장 단계"), value: result.workflow_recommendation.recommended_steps.join(" / ") || notAvailableLabel },
              { label: pick(locale, "Flags to review", "검토 플래그"), value: result.workflow_recommendation.flags_to_review.join(" / ") || notAvailableLabel },
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
