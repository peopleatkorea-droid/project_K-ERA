"use client";

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
      <p>
        {pick(
          locale,
          "AI Clinic will use the validated model version to retrieve similar patient cases from the local hospital dataset.",
          "AI Clinic은 검증에 사용된 모델 버전으로 병원 내부 데이터셋에서 유사 환자 케이스를 검색합니다."
        )}
      </p>
    );
  }

  return (
    <div className="panel-stack">
      <div className="panel-metric-grid">
        <div>
          <strong>{result.similar_cases.length}</strong>
          <span>{pick(locale, "similar patients", "유사 환자")}</span>
        </div>
        <div>
          <strong>{result.eligible_candidate_count}</strong>
          <span>{pick(locale, "eligible cases", "검색 가능 케이스")}</span>
        </div>
        <div>
          <strong>{result.model_version.version_name ?? notAvailableLabel}</strong>
          <span>{pick(locale, "retrieval model", "검색 모델")}</span>
        </div>
        <div>
          <strong>{result.execution_device}</strong>
          <span>{pick(locale, "device", "디바이스")}</span>
        </div>
        <div>
          <strong>{result.retrieval_mode}</strong>
          <span>{pick(locale, "retrieval mode", "검색 모드")}</span>
        </div>
        <div>
          <strong>{result.vector_index_mode ?? notAvailableLabel}</strong>
          <span>{pick(locale, "vector index", "벡터 인덱스")}</span>
        </div>
        <div>
          <strong>{result.text_evidence.length}</strong>
          <span>{pick(locale, "text evidence", "텍스트 근거")}</span>
        </div>
        <div>
          <strong>{result.text_retrieval_mode ?? notAvailableLabel}</strong>
          <span>{pick(locale, "text retrieval", "텍스트 검색")}</span>
        </div>
      </div>
      <p>
        {pick(
          locale,
          "Top-K retrieval is limited to one case per patient, so the result list stays patient-diverse.",
          "Top-K 검색은 환자당 1개 케이스만 남기도록 제한해 결과 목록이 환자 다양성을 유지합니다."
        )}
      </p>
      {result.text_retrieval_mode === "unavailable" ? (
        <div className="panel-image-fallback">
          {result.text_retrieval_error
            ? `${aiClinicTextUnavailableLabel} (${result.text_retrieval_error})`
            : aiClinicTextUnavailableLabel}
        </div>
      ) : null}
      {result.retrieval_warning ? <div className="panel-image-fallback">{result.retrieval_warning}</div> : null}
      {result.similar_cases.length === 0 ? (
        <div className="panel-image-fallback">
          {pick(
            locale,
            "No eligible similar patient was found for this model and crop setup yet.",
            "현재 모델과 crop 설정 기준으로 검색 가능한 유사 환자가 아직 없습니다."
          )}
        </div>
      ) : (
        <div className="ops-list">
          {result.similar_cases.map((item, index) => (
            <article key={`${item.patient_id}-${item.visit_date}`} className="ops-item">
              <div className="panel-card-head">
                <strong>{pick(locale, `Patient ${index + 1}`, `환자 ${index + 1}`)}</strong>
                <span>{displayVisitReference(item.visit_date)}</span>
              </div>
              <div className="panel-meta">
                <span>{item.local_case_code || item.chart_alias || item.patient_id}</span>
                <span>{pick(locale, "Similarity", "유사도")} {formatSemanticScore(item.similarity, notAvailableLabel)}</span>
                {typeof item.classifier_similarity === "number" ? (
                  <span>{pick(locale, "Classifier", "분류기")} {formatSemanticScore(item.classifier_similarity, notAvailableLabel)}</span>
                ) : null}
                {typeof item.dinov2_similarity === "number" ? (
                  <span>DINOv2 {formatSemanticScore(item.dinov2_similarity, notAvailableLabel)}</span>
                ) : null}
                <span>{translateOption(locale, "cultureCategory", item.culture_category)}</span>
              </div>
              <div className="panel-meta">
                {typeof item.base_similarity === "number" ? (
                  <span>{pick(locale, "Base", "기본")} {formatSemanticScore(item.base_similarity, notAvailableLabel)}</span>
                ) : null}
                {typeof item.metadata_reranking?.adjustment === "number" ? (
                  <span>
                    {pick(locale, "Metadata", "Metadata")} {item.metadata_reranking.adjustment >= 0 ? "+" : ""}
                    {formatSemanticScore(item.metadata_reranking.adjustment, notAvailableLabel)}
                  </span>
                ) : null}
                <span>{item.culture_species || notAvailableLabel}</span>
                <span>{`${translateOption(locale, "sex", item.sex ?? "unknown")} · ${item.age ?? notAvailableLabel}`}</span>
                <span>{translateOption(locale, "view", item.representative_view ?? "white")}</span>
                <span>{translateOption(locale, "visitStatus", item.visit_status ?? "active")}</span>
                <span>{pick(locale, "Q-score", "Q-score")} {formatImageQualityScore(item.quality_score, notAvailableLabel)}</span>
                <span>{translateOption(locale, "contactLens", item.contact_lens_use ?? "unknown")}</span>
                {item.smear_result ? <span>{pick(locale, "Smear", "Smear")} {item.smear_result}</span> : null}
                {item.polymicrobial ? <span>{pick(locale, "Polymicrobial", "Polymicrobial")}</span> : null}
                {item.predisposing_factor && item.predisposing_factor.length > 0 ? (
                  <span>{item.predisposing_factor.map((factor) => translateOption(locale, "predisposing", factor)).join(" · ")}</span>
                ) : null}
              </div>
              {item.metadata_reranking?.alignment ? (
                <div className="panel-meta">
                  {(item.metadata_reranking.alignment.matched_fields ?? []).length > 0 ? (
                    <span>
                      {pick(locale, "Matched", "Matched")}{" "}
                      {(item.metadata_reranking.alignment.matched_fields ?? []).map(formatMetadataField).join(", ")}
                    </span>
                  ) : null}
                  {(item.metadata_reranking.alignment.conflicted_fields ?? []).length > 0 ? (
                    <span>
                      {pick(locale, "Conflicts", "Conflicts")}{" "}
                      {(item.metadata_reranking.alignment.conflicted_fields ?? []).map(formatMetadataField).join(", ")}
                    </span>
                  ) : null}
                </div>
              ) : null}
              {item.preview_url ? (
                <div className="panel-image-card">
                  <img
                    src={item.preview_url}
                    alt={pick(locale, `${item.patient_id} representative image`, `${item.patient_id} 대표 이미지`)}
                    className="panel-image-preview"
                  />
                  <div className="panel-image-copy">
                    <strong>{pick(locale, "Representative image", "대표 이미지")}</strong>
                    <span>{item.culture_species || notAvailableLabel}</span>
                  </div>
                </div>
              ) : (
                <div className="panel-image-fallback">
                  {pick(locale, "Representative image preview is unavailable.", "대표 이미지 미리보기를 불러올 수 없습니다.")}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {result.text_evidence.length > 0 ? (
        <div className="panel-stack">
          <div className="panel-card-head">
            <strong>{pick(locale, "Retrieved text evidence", "검색된 텍스트 근거")}</strong>
            <span>
              {pick(
                locale,
                `${result.eligible_text_count ?? result.text_evidence.length} indexed cases`,
                `색인 케이스 ${result.eligible_text_count ?? result.text_evidence.length}건`
              )}
            </span>
          </div>
          <div className="ops-list">
            {result.text_evidence.map((item, index) => (
              <article key={`${item.patient_id}-${item.visit_date}-text`} className="ops-item">
                <div className="panel-card-head">
                  <strong>{pick(locale, `Evidence ${index + 1}`, `근거 ${index + 1}`)}</strong>
                  <span>{displayVisitReference(item.visit_date)}</span>
                </div>
                <div className="panel-meta">
                  <span>{item.local_case_code || item.chart_alias || item.patient_id}</span>
                  <span>{pick(locale, "Similarity", "유사도")} {formatSemanticScore(item.similarity, notAvailableLabel)}</span>
                  <span>{translateOption(locale, "cultureCategory", item.culture_category)}</span>
                  <span>{item.culture_species || notAvailableLabel}</span>
                </div>
                <p>{item.text}</p>
              </article>
            ))}
          </div>
        </div>
      ) : null}
      {result.differential ? (
        <div className="panel-stack">
          <div className="panel-card-head">
            <strong>{pick(locale, "Differential ranking", "Differential ranking")}</strong>
            <span>{result.differential.engine}</span>
          </div>
          <div className="panel-meta">
            <span>
              {pick(locale, "Top label", "Top label")}{" "}
              {result.differential.top_label
                ? translateOption(locale, "cultureCategory", result.differential.top_label)
                : notAvailableLabel}
            </span>
            <span>{pick(locale, "Uncertainty", "Uncertainty")} {result.differential.overall_uncertainty}</span>
            <span>{pick(locale, "Generated", "Generated")} {result.differential.generated_at ?? notAvailableLabel}</span>
          </div>
          <div className="ops-list">
            {result.differential.differential.map((item, index) => (
              <article key={`differential-${item.label}`} className="ops-item">
                <div className="panel-card-head">
                  <strong>
                    {index + 1}. {translateOption(locale, "cultureCategory", item.label)}
                  </strong>
                  <span>{item.confidence_band}</span>
                </div>
                <div className="panel-meta">
                  <span>{pick(locale, "Score", "Score")} {formatProbability(item.score, notAvailableLabel)}</span>
                  <span>{pick(locale, "Classifier", "Classifier")} {formatSemanticScore(item.component_scores.classifier, notAvailableLabel)}</span>
                  <span>{pick(locale, "Retrieval", "Retrieval")} {formatSemanticScore(item.component_scores.retrieval, notAvailableLabel)}</span>
                  <span>{pick(locale, "Text", "Text")} {formatSemanticScore(item.component_scores.text, notAvailableLabel)}</span>
                  <span>{pick(locale, "Metadata", "Metadata")} {formatSemanticScore(item.component_scores.metadata, notAvailableLabel)}</span>
                  <span>{pick(locale, "Penalty", "Penalty")} {formatSemanticScore(item.component_scores.quality_penalty, notAvailableLabel)}</span>
                </div>
                {item.supporting_evidence.length > 0 ? (
                  <div className="panel-stack">
                    <strong>{pick(locale, "Supporting evidence", "Supporting evidence")}</strong>
                    <div className="ops-list">
                      {item.supporting_evidence.map((entry, evidenceIndex) => (
                        <article key={`differential-support-${item.label}-${evidenceIndex}`} className="ops-item">
                          <p>{entry}</p>
                        </article>
                      ))}
                    </div>
                  </div>
                ) : null}
                {item.conflicting_evidence.length > 0 ? (
                  <div className="panel-stack">
                    <strong>{pick(locale, "Conflicting evidence", "Conflicting evidence")}</strong>
                    <div className="ops-list">
                      {item.conflicting_evidence.map((entry, evidenceIndex) => (
                        <article key={`differential-conflict-${item.label}-${evidenceIndex}`} className="ops-item">
                          <p>{entry}</p>
                        </article>
                      ))}
                    </div>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </div>
      ) : null}
      {result.workflow_recommendation ? (
        <div className="panel-stack">
          <div className="panel-card-head">
            <strong>{pick(locale, "Workflow recommendation", "워크플로 추천")}</strong>
            <span>{result.workflow_recommendation.mode}</span>
          </div>
          <div className="panel-meta">
            <span>{pick(locale, "LLM model", "LLM 모델")} {result.workflow_recommendation.model ?? notAvailableLabel}</span>
            <span>{pick(locale, "Generated", "생성 시각")} {result.workflow_recommendation.generated_at ?? notAvailableLabel}</span>
          </div>
          {result.workflow_recommendation.llm_error ? (
            <div className="panel-image-fallback">
              {pick(
                locale,
                `LLM generation failed and AI Clinic used the local fallback instead. ${result.workflow_recommendation.llm_error}`,
                `LLM 생성에 실패해 로컬 fallback recommendation을 사용했습니다. ${result.workflow_recommendation.llm_error}`
              )}
            </div>
          ) : null}
          <p>{result.workflow_recommendation.summary}</p>
          <div className="ops-list">
            {result.workflow_recommendation.recommended_steps.map((step, index) => (
              <article key={`workflow-step-${index}`} className="ops-item">
                <div className="panel-card-head">
                  <strong>{pick(locale, `Step ${index + 1}`, `단계 ${index + 1}`)}</strong>
                </div>
                <p>{step}</p>
              </article>
            ))}
          </div>
          <div className="panel-stack">
            <div className="panel-card-head">
              <strong>{pick(locale, "Flags to review", "우선 확인 플래그")}</strong>
            </div>
            <div className="ops-list">
              {result.workflow_recommendation.flags_to_review.map((flag, index) => (
                <article key={`workflow-flag-${index}`} className="ops-item">
                  <p>{flag}</p>
                </article>
              ))}
            </div>
          </div>
          <p>
            <strong>{pick(locale, "Rationale", "근거")}</strong> {result.workflow_recommendation.rationale}
          </p>
          <p>
            <strong>{pick(locale, "Uncertainty", "불확실성")}</strong> {result.workflow_recommendation.uncertainty}
          </p>
          <p>{result.workflow_recommendation.disclaimer}</p>
        </div>
      ) : null}
    </div>
  );
}
