"use client";

import type { ReactNode } from "react";

import { Card } from "../ui/card";
import { SectionHeader } from "../ui/section-header";
import { docSectionHeadClass } from "../ui/workspace-patterns";
import type { AiClinicResponse, AiClinicSimilarCaseRecord } from "../../lib/api";
import { pick, translateOption, type Locale } from "../../lib/i18n";

type AiClinicSimilarCasePreview = AiClinicSimilarCaseRecord & {
  preview_url: string | null;
};

type AiClinicPreviewResponse = Omit<AiClinicResponse, "similar_cases"> & {
  similar_cases: AiClinicSimilarCasePreview[];
};

type Props = {
  locale: Locale;
  result: AiClinicPreviewResponse | null;
  notAvailableLabel: string;
  aiClinicTextUnavailableLabel: string;
  displayVisitReference: (visitReference: string) => string;
  formatSemanticScore: (value: number | null | undefined, emptyLabel?: string) => string;
  formatImageQualityScore: (value: number | null | undefined, emptyLabel?: string) => string;
  formatProbability: (value: number | null | undefined, emptyLabel?: string) => string;
  formatMetadataField: (field: string) => string;
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

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
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

export function AiClinicResult({
  locale,
  result,
  notAvailableLabel,
  aiClinicTextUnavailableLabel,
  displayVisitReference,
  formatSemanticScore,
  formatImageQualityScore,
  formatProbability,
  formatMetadataField,
}: Props) {
  if (!result) {
    return (
      <p className="m-0 text-sm leading-6 text-muted">
        {pick(
          locale,
          "AI Clinic will use the validated model version to retrieve similar patient cases from the local hospital dataset.",
          "AI Clinic은 검증된 모델 버전으로 병원 내 유사 환자 케이스를 검색합니다."
        )}
      </p>
    );
  }

  const queryCase = result.query_case;
  const classification = result.classification_context;

  return (
    <div className="grid gap-4">
      <Section title={pick(locale, "Retrieval overview", "검색 개요")}>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label={pick(locale, "similar patients", "유사 환자")} value={result.similar_cases.length} />
          <KpiCard label={pick(locale, "eligible cases", "검색 가능 케이스")} value={result.eligible_candidate_count} />
          <KpiCard label={pick(locale, "top-k", "top-k")} value={result.top_k} />
          <KpiCard label={pick(locale, "text evidence", "텍스트 근거")} value={result.text_evidence.length} />
          <KpiCard label={pick(locale, "retrieval model", "검색 모델")} value={result.model_version.version_name ?? notAvailableLabel} />
          <KpiCard label={pick(locale, "device", "디바이스")} value={result.execution_device} />
          <KpiCard label={pick(locale, "retrieval mode", "검색 모드")} value={result.retrieval_mode} />
          <KpiCard label={pick(locale, "vector index", "벡터 인덱스")} value={result.vector_index_mode ?? notAvailableLabel} />
        </div>

        <FieldGrid
          items={[
            {
              label: pick(locale, "Text retrieval", "텍스트 검색"),
              value: result.text_retrieval_mode ?? notAvailableLabel,
            },
            {
              label: pick(locale, "Text embedding", "텍스트 임베딩"),
              value: result.text_embedding_model ?? notAvailableLabel,
            },
            {
              label: pick(locale, "Metadata reranking", "메타데이터 재정렬"),
              value: result.metadata_reranking ?? notAvailableLabel,
            },
            {
              label: pick(locale, "Backends", "백엔드"),
              value: joinValues(result.retrieval_backends_used, notAvailableLabel),
            },
          ]}
        />

        <p className="m-0 text-sm leading-6 text-muted">
          {pick(
            locale,
            "Top-K retrieval is limited to one case per patient, so the result list stays patient-diverse.",
            "Top-K 검색은 환자당 한 케이스로 제한되어 결과 목록의 환자 다양성을 유지합니다."
          )}
        </p>

        {result.text_retrieval_mode === "unavailable" ? (
          <Message>
            {result.text_retrieval_error
              ? `${aiClinicTextUnavailableLabel} (${result.text_retrieval_error})`
              : aiClinicTextUnavailableLabel}
          </Message>
        ) : null}
        {result.retrieval_warning ? <Message>{result.retrieval_warning}</Message> : null}
      </Section>

      <Section title={pick(locale, "Query context", "질의 케이스 컨텍스트")}>
        <FieldGrid
          items={[
            {
              label: pick(locale, "Patient / visit", "환자 / 방문"),
              value: `${queryCase.patient_id} / ${displayVisitReference(queryCase.visit_date)}`,
            },
            {
              label: pick(locale, "Case ID", "케이스 ID"),
              value: queryCase.case_id,
            },
            {
              label: pick(locale, "Demographics", "기본 정보"),
              value: `${translateOption(locale, "sex", queryCase.sex ?? "unknown")} / ${queryCase.age ?? notAvailableLabel}`,
            },
            {
              label: pick(locale, "Representative view", "대표 view"),
              value: translateOption(locale, "view", queryCase.representative_view ?? "white"),
            },
            {
              label: pick(locale, "Visit status", "방문 상태"),
              value: translateOption(locale, "visitStatus", queryCase.visit_status ?? "active"),
            },
            {
              label: pick(locale, "Contact lens", "콘택트렌즈"),
              value: translateOption(locale, "contactLens", queryCase.contact_lens_use ?? "unknown"),
            },
            {
              label: pick(locale, "Predisposing factors", "선행 인자"),
              value: joinValues(
                (queryCase.predisposing_factor ?? []).map((factor) => translateOption(locale, "predisposing", factor)),
                notAvailableLabel
              ),
            },
            {
              label: pick(locale, "Image quality", "이미지 품질"),
              value: `${pick(locale, "Q-score", "Q-score")} ${formatImageQualityScore(queryCase.quality_score, notAvailableLabel)} / ${pick(locale, "View score", "View score")} ${formatImageQualityScore(queryCase.view_score, notAvailableLabel)}`,
            },
            {
              label: pick(locale, "Smear / polymicrobial", "도말 / 다균종"),
              value: `${queryCase.smear_result ?? notAvailableLabel} / ${queryCase.polymicrobial ? pick(locale, "yes", "예") : pick(locale, "no", "아니오")}`,
            },
          ]}
        />

        {classification ? (
          <Card as="div" variant="nested" className="grid gap-4 border border-border/80 p-4">
            <SectionHeader title={pick(locale, "Validation context", "검증 컨텍스트")} titleAs="h4" className={docSectionHeadClass} />
            <FieldGrid
              items={[
                {
                  label: pick(locale, "Validation ID", "검증 ID"),
                  value: classification.validation_id ?? notAvailableLabel,
                },
                {
                  label: pick(locale, "Model version", "모델 버전"),
                  value: classification.model_version ?? classification.model_version_id ?? notAvailableLabel,
                },
                {
                  label: pick(locale, "Predicted label", "예측 라벨"),
                  value: classification.predicted_label
                    ? translateOption(locale, "cultureCategory", classification.predicted_label)
                    : notAvailableLabel,
                },
                {
                  label: pick(locale, "True label", "실제 라벨"),
                  value: classification.true_label
                    ? translateOption(locale, "cultureCategory", classification.true_label)
                    : notAvailableLabel,
                },
                {
                  label: pick(locale, "Prediction probability", "예측 확률"),
                  value: formatProbability(classification.prediction_probability, notAvailableLabel),
                },
                {
                  label: pick(locale, "Correct", "정답 여부"),
                  value:
                    classification.is_correct === null || classification.is_correct === undefined
                      ? notAvailableLabel
                      : classification.is_correct
                        ? pick(locale, "correct", "정답")
                        : pick(locale, "incorrect", "오답"),
                },
              ]}
            />
          </Card>
        ) : null}
      </Section>

      <Section
        title={pick(locale, "Similar patients", "유사 환자")}
        subtitle={
          result.similar_cases.length > 0
            ? pick(locale, `${result.similar_cases.length} ranked results`, `${result.similar_cases.length}개 순위 결과`)
            : undefined
        }
      >
        {result.similar_cases.length === 0 ? (
          <Message>
            {pick(
              locale,
              "No eligible similar patient was found for this model and crop setup yet.",
              "현재 모델과 crop 설정 기준으로 검색 가능한 유사 환자가 아직 없습니다."
            )}
          </Message>
        ) : (
          <div className="grid gap-4">
            {result.similar_cases.map((item, index) => (
              <Card
                key={`${item.patient_id}-${item.visit_date}`}
                as="article"
                variant="nested"
                className="grid gap-4 border border-border/80 p-4"
              >
                <SectionHeader
                  title={pick(locale, `Patient ${index + 1}`, `환자 ${index + 1}`)}
                  titleAs="h4"
                  description={displayVisitReference(item.visit_date)}
                  aside={
                    <div className="flex flex-wrap gap-2">
                      <Badge>{`${pick(locale, "Similarity", "유사도")} ${formatSemanticScore(item.similarity, notAvailableLabel)}`}</Badge>
                      {typeof item.classifier_similarity === "number" ? (
                        <Badge>{`${pick(locale, "Classifier", "분류기")} ${formatSemanticScore(item.classifier_similarity, notAvailableLabel)}`}</Badge>
                      ) : null}
                      {typeof item.dinov2_similarity === "number" ? (
                        <Badge>{`DINOv2 ${formatSemanticScore(item.dinov2_similarity, notAvailableLabel)}`}</Badge>
                      ) : null}
                    </div>
                  }
                />

                <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
                  <div className="min-w-0">
                    {item.preview_url ? (
                      <Card as="div" variant="panel" className="overflow-hidden">
                        <img
                          src={item.preview_url}
                          alt={pick(locale, `${item.patient_id} representative image`, `${item.patient_id} 대표 이미지`)}
                          className="aspect-[4/3] w-full object-cover"
                        />
                        <div className="grid gap-1 p-4">
                          <strong className="text-sm font-semibold text-ink">{pick(locale, "Representative image", "대표 이미지")}</strong>
                          <span className="text-sm text-muted">{item.culture_species || notAvailableLabel}</span>
                        </div>
                      </Card>
                    ) : (
                      <Message>{pick(locale, "Representative image preview is unavailable.", "대표 이미지 미리보기를 불러올 수 없습니다.")}</Message>
                    )}
                  </div>

                  <div className="grid gap-4">
                    <FieldGrid
                      items={[
                        {
                          label: pick(locale, "Patient / code", "환자 / 코드"),
                          value: item.local_case_code || item.chart_alias || item.patient_id,
                        },
                        {
                          label: pick(locale, "Culture", "배양"),
                          value: `${translateOption(locale, "cultureCategory", item.culture_category)} / ${item.culture_species || notAvailableLabel}`,
                        },
                        {
                          label: pick(locale, "Base similarity", "기본 유사도"),
                          value:
                            typeof item.base_similarity === "number"
                              ? formatSemanticScore(item.base_similarity, notAvailableLabel)
                              : notAvailableLabel,
                        },
                        {
                          label: pick(locale, "Metadata adjustment", "메타데이터 보정"),
                          value:
                            typeof item.metadata_reranking?.adjustment === "number"
                              ? `${item.metadata_reranking.adjustment >= 0 ? "+" : ""}${formatSemanticScore(item.metadata_reranking.adjustment, notAvailableLabel)}`
                              : notAvailableLabel,
                        },
                        {
                          label: pick(locale, "Demographics", "기본 정보"),
                          value: `${translateOption(locale, "sex", item.sex ?? "unknown")} / ${item.age ?? notAvailableLabel}`,
                        },
                        {
                          label: pick(locale, "View / visit status", "View / 방문 상태"),
                          value: `${translateOption(locale, "view", item.representative_view ?? "white")} / ${translateOption(locale, "visitStatus", item.visit_status ?? "active")}`,
                        },
                        {
                          label: pick(locale, "Image quality", "이미지 품질"),
                          value: `${pick(locale, "Q-score", "Q-score")} ${formatImageQualityScore(item.quality_score, notAvailableLabel)}`,
                        },
                        {
                          label: pick(locale, "Contact lens", "콘택트렌즈"),
                          value: translateOption(locale, "contactLens", item.contact_lens_use ?? "unknown"),
                        },
                        {
                          label: pick(locale, "Smear / polymicrobial", "도말 / 다균종"),
                          value: `${item.smear_result ?? notAvailableLabel} / ${item.polymicrobial ? pick(locale, "yes", "예") : pick(locale, "no", "아니오")}`,
                        },
                        {
                          label: pick(locale, "Predisposing factors", "선행 인자"),
                          value: joinValues(
                            (item.predisposing_factor ?? []).map((factor) => translateOption(locale, "predisposing", factor)),
                            notAvailableLabel
                          ),
                        },
                      ]}
                    />

                    {item.metadata_reranking?.alignment ? (
                      <Card as="div" variant="nested" className="grid gap-4 border border-border/80 p-4">
                        <SectionHeader title={pick(locale, "Metadata alignment", "메타데이터 정렬")} titleAs="h4" className={docSectionHeadClass} />
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-[18px] border border-border bg-surface px-4 py-3">
                            <span className="block text-[0.82rem] text-muted">{pick(locale, "Matched", "일치")}</span>
                            <strong className="mt-1 block text-sm leading-6 text-ink">
                              {(item.metadata_reranking.alignment.matched_fields ?? []).length > 0
                                ? (item.metadata_reranking.alignment.matched_fields ?? []).map(formatMetadataField).join(", ")
                                : notAvailableLabel}
                            </strong>
                          </div>
                          <div className="rounded-[18px] border border-border bg-surface px-4 py-3">
                            <span className="block text-[0.82rem] text-muted">{pick(locale, "Conflicts", "충돌")}</span>
                            <strong className="mt-1 block text-sm leading-6 text-ink">
                              {(item.metadata_reranking.alignment.conflicted_fields ?? []).length > 0
                                ? (item.metadata_reranking.alignment.conflicted_fields ?? []).map(formatMetadataField).join(", ")
                                : notAvailableLabel}
                            </strong>
                          </div>
                        </div>
                      </Card>
                    ) : null}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Section>

      {result.text_evidence.length > 0 ? (
        <Section
          title={pick(locale, "Retrieved text evidence", "검색된 텍스트 근거")}
          subtitle={pick(
            locale,
            `${result.eligible_text_count ?? result.text_evidence.length} indexed cases`,
            `인덱싱된 케이스 ${result.eligible_text_count ?? result.text_evidence.length}개`
          )}
        >
          <div className="grid gap-4">
            {result.text_evidence.map((item, index) => (
              <Card
                key={`${item.patient_id}-${item.visit_date}-text`}
                as="article"
                variant="nested"
                className="grid gap-4 border border-border/80 p-4"
              >
                <SectionHeader
                  title={pick(locale, `Evidence ${index + 1}`, `근거 ${index + 1}`)}
                  titleAs="h4"
                  description={displayVisitReference(item.visit_date)}
                />
                <FieldGrid
                  items={[
                    {
                      label: pick(locale, "Patient / code", "환자 / 코드"),
                      value: item.local_case_code || item.chart_alias || item.patient_id,
                    },
                    {
                      label: pick(locale, "Similarity", "유사도"),
                      value: formatSemanticScore(item.similarity, notAvailableLabel),
                    },
                    {
                      label: pick(locale, "Culture", "배양"),
                      value: `${translateOption(locale, "cultureCategory", item.culture_category)} / ${item.culture_species || notAvailableLabel}`,
                    },
                  ]}
                />
                <p className="m-0 whitespace-pre-wrap text-sm leading-6 text-muted">{item.text}</p>
              </Card>
            ))}
          </div>
        </Section>
      ) : null}

      {result.differential ? (
        <Section title={pick(locale, "Differential ranking", "감별 진단 랭킹")} subtitle={result.differential.engine}>
          <FieldGrid
            items={[
              {
                label: pick(locale, "Top label", "최상위 라벨"),
                value: result.differential.top_label
                  ? translateOption(locale, "cultureCategory", result.differential.top_label)
                  : notAvailableLabel,
              },
              {
                label: pick(locale, "Uncertainty", "불확실성"),
                value: result.differential.overall_uncertainty,
              },
              {
                label: pick(locale, "Generated", "생성 시각"),
                value: result.differential.generated_at ?? notAvailableLabel,
              },
            ]}
          />

          <div className="grid gap-4">
            {result.differential.differential.map((item, index) => (
              <Card key={`differential-${item.label}`} as="article" variant="nested" className="grid gap-4 border border-border/80 p-4">
                <SectionHeader
                  title={`${index + 1}. ${translateOption(locale, "cultureCategory", item.label)}`}
                  titleAs="h4"
                  aside={<Badge>{item.confidence_band}</Badge>}
                />
                <FieldGrid
                  items={[
                    {
                      label: pick(locale, "Score", "점수"),
                      value: formatProbability(item.score, notAvailableLabel),
                    },
                    {
                      label: pick(locale, "Classifier", "분류기"),
                      value: formatSemanticScore(item.component_scores.classifier, notAvailableLabel),
                    },
                    {
                      label: pick(locale, "Retrieval", "검색"),
                      value: formatSemanticScore(item.component_scores.retrieval, notAvailableLabel),
                    },
                    {
                      label: pick(locale, "Text", "텍스트"),
                      value: formatSemanticScore(item.component_scores.text, notAvailableLabel),
                    },
                    {
                      label: pick(locale, "Metadata", "메타데이터"),
                      value: formatSemanticScore(item.component_scores.metadata, notAvailableLabel),
                    },
                    {
                      label: pick(locale, "Penalty", "패널티"),
                      value: formatSemanticScore(item.component_scores.quality_penalty, notAvailableLabel),
                    },
                  ]}
                />

                {item.supporting_evidence.length > 0 || item.conflicting_evidence.length > 0 ? (
                  <div className="grid gap-4 lg:grid-cols-2">
                    <Card as="div" variant="nested" className="grid gap-3 border border-border/80 p-4">
                      <SectionHeader title={pick(locale, "Supporting evidence", "지지 근거")} titleAs="h4" className={docSectionHeadClass} />
                      {item.supporting_evidence.length > 0 ? (
                        <div className="grid gap-3">
                          {item.supporting_evidence.map((entry, evidenceIndex) => (
                            <Card key={`differential-support-${item.label}-${evidenceIndex}`} as="article" variant="panel" className="p-4">
                              <p className="m-0 text-sm leading-6 text-muted">{entry}</p>
                            </Card>
                          ))}
                        </div>
                      ) : (
                        <Message>{notAvailableLabel}</Message>
                      )}
                    </Card>

                    <Card as="div" variant="nested" className="grid gap-3 border border-border/80 p-4">
                      <SectionHeader title={pick(locale, "Conflicting evidence", "상충 근거")} titleAs="h4" className={docSectionHeadClass} />
                      {item.conflicting_evidence.length > 0 ? (
                        <div className="grid gap-3">
                          {item.conflicting_evidence.map((entry, evidenceIndex) => (
                            <Card key={`differential-conflict-${item.label}-${evidenceIndex}`} as="article" variant="panel" className="p-4">
                              <p className="m-0 text-sm leading-6 text-muted">{entry}</p>
                            </Card>
                          ))}
                        </div>
                      ) : (
                        <Message>{notAvailableLabel}</Message>
                      )}
                    </Card>
                  </div>
                ) : null}
              </Card>
            ))}
          </div>
        </Section>
      ) : null}

      {result.workflow_recommendation ? (
        <Section
          title={pick(locale, "Workflow recommendation", "워크플로 추천")}
          subtitle={result.workflow_recommendation.mode}
        >
          <FieldGrid
            items={[
              {
                label: pick(locale, "LLM model", "LLM 모델"),
                value: result.workflow_recommendation.model ?? notAvailableLabel,
              },
              {
                label: pick(locale, "Generated", "생성 시각"),
                value: result.workflow_recommendation.generated_at ?? notAvailableLabel,
              },
            ]}
          />

          {result.workflow_recommendation.llm_error ? (
            <Message>
              {pick(
                locale,
                `LLM generation failed and AI Clinic used the local fallback instead. ${result.workflow_recommendation.llm_error}`,
                `LLM 생성에 실패하여 AI Clinic이 로컬 fallback recommendation을 사용했습니다. ${result.workflow_recommendation.llm_error}`
              )}
            </Message>
          ) : null}

          <Card as="div" variant="panel" className="grid gap-3 p-4">
            <SectionHeader title={pick(locale, "Summary", "요약")} titleAs="h4" className={docSectionHeadClass} />
            <p className="m-0 text-sm leading-6 text-muted">{result.workflow_recommendation.summary}</p>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card as="div" variant="nested" className="grid gap-3 border border-border/80 p-4">
              <SectionHeader title={pick(locale, "Recommended steps", "권장 단계")} titleAs="h4" className={docSectionHeadClass} />
              <div className="grid gap-3">
                {result.workflow_recommendation.recommended_steps.map((step, index) => (
                  <Card key={`workflow-step-${index}`} as="article" variant="panel" className="grid gap-2 p-4">
                    <strong className="text-sm font-semibold text-ink">{pick(locale, `Step ${index + 1}`, `단계 ${index + 1}`)}</strong>
                    <p className="m-0 text-sm leading-6 text-muted">{step}</p>
                  </Card>
                ))}
              </div>
            </Card>

            <Card as="div" variant="nested" className="grid gap-3 border border-border/80 p-4">
              <SectionHeader title={pick(locale, "Flags to review", "우선 확인 플래그")} titleAs="h4" className={docSectionHeadClass} />
              <div className="grid gap-3">
                {result.workflow_recommendation.flags_to_review.map((flag, index) => (
                  <Card key={`workflow-flag-${index}`} as="article" variant="panel" className="p-4">
                    <p className="m-0 text-sm leading-6 text-muted">{flag}</p>
                  </Card>
                ))}
              </div>
            </Card>
          </div>

          <FieldGrid
            items={[
              {
                label: pick(locale, "Rationale", "근거"),
                value: result.workflow_recommendation.rationale,
              },
              {
                label: pick(locale, "Uncertainty", "불확실성"),
                value: result.workflow_recommendation.uncertainty,
              },
              {
                label: pick(locale, "Disclaimer", "주의"),
                value: result.workflow_recommendation.disclaimer,
              },
            ]}
          />
        </Section>
      ) : null}
    </div>
  );
}
