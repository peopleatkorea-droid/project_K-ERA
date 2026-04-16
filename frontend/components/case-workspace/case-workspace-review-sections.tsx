"use client";

import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useMemo,
  useState,
} from "react";

import type {
  CaseContributionResponse,
  CaseHistoryResponse,
  CaseSummaryRecord,
  CaseValidationCompareResponse,
  CaseValidationResponse,
  ContributionLeaderboard,
  ModelVersionRecord,
} from "../../lib/api";
import { pick, type Locale } from "../../lib/i18n";
import { AiClinicPanel } from "./ai-clinic-panel";
import { AiClinicResult } from "./ai-clinic-result";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { CompletionCard } from "./completion-card";
import { ContributionHistoryPanel } from "./contribution-history-panel";
import { SavedCasePreviewPanels } from "./saved-case-preview-panels";
import type {
  AiClinicPreviewResponse,
  LesionPreviewCard,
  LocalePick,
  RoiPreviewCard,
  TranslateOption,
} from "./shared";
import { ValidationArtifactStack } from "./validation-artifact-stack";
import { ValidationPanel } from "./validation-panel";
import {
  confidencePercent,
  confidenceTone,
  formatAiClinicMetadataField,
  formatImageQualityScore,
  formatProbability,
  formatSemanticScore,
  predictedClassConfidence,
} from "./case-workspace-review-formatters";
import {
  docSectionClass,
  docSectionHeadClass,
  docSectionLabelClass,
  docSiteBadgeClass,
  panelStackClass,
} from "../ui/workspace-patterns";
import { SectionHeader } from "../ui/section-header";

const MAX_MODEL_COMPARE_SELECTIONS = 8;

type AnalysisReviewStep = "judgment" | "agreement" | "ai_clinic";

function reviewStepStatusToneClass(
  tone: "ready" | "running" | "complete" | "blocked" | "waiting",
): string {
  switch (tone) {
    case "ready":
      return "border-sky-500/15 bg-sky-500/10 text-sky-700 dark:text-sky-300";
    case "running":
      return "border-amber-500/15 bg-amber-500/10 text-amber-700 dark:text-amber-300";
    case "complete":
      return "border-emerald-500/15 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
    case "blocked":
      return "border-border bg-surface-muted text-muted";
    default:
      return "border-violet-500/15 bg-violet-500/10 text-violet-700 dark:text-violet-300";
  }
}

type ToastState = {
  tone: "success" | "error";
  message: string;
} | null;

type CompletionState = {
  kind: "saved" | "contributed";
  patient_id: string;
  visit_date: string;
  timestamp: string;
  stats?: {
    user_contributions: number;
    total_contributions: number;
    user_contribution_pct: number;
  };
  update_id?: string;
  update_count?: number;
};

type AnalysisSectionProps = {
  locale: Locale;
  token: string;
  selectedSiteId: string | null;
  mounted: boolean;
  analysisEyebrow: string;
  analysisTitle: string;
  analysisDescription: string;
  imageCountLabel: string;
  commonLoading: string;
  commonNotAvailable: string;
  hasSelectedCase: boolean;
  canRunRoiPreview: boolean;
  canRunValidation: boolean;
  canRunAiClinic: boolean;
  selectedCaseImageCount: number;
  representativePreviewUrl: string | null | undefined;
  selectedCompareModelVersionIds: string[];
  selectedValidationModelVersionId: string | null;
  compareModelCandidates: ModelVersionRecord[];
  validationBusy: boolean;
  validationResult: CaseValidationResponse | null;
  validationArtifacts: {
    roi_crop?: string | null;
    gradcam?: string | null;
    gradcam_cornea?: string | null;
    gradcam_lesion?: string | null;
    medsam_mask?: string | null;
    lesion_crop?: string | null;
    lesion_mask?: string | null;
  };
  modelCompareBusy: boolean;
  modelCompareResult: CaseValidationCompareResponse | null;
  aiClinicBusy: boolean;
  aiClinicExpandedBusy: boolean;
  aiClinicResult: AiClinicPreviewResponse | null;
  aiClinicPreviewBusy: boolean;
  hasAnySavedLesionBox: boolean;
  roiPreviewBusy: boolean;
  lesionPreviewBusy: boolean;
  roiPreviewItems: RoiPreviewCard[];
  lesionPreviewItems: LesionPreviewCard[];
  pickLabel: LocalePick;
  translateOption: TranslateOption;
  setToast: Dispatch<SetStateAction<ToastState>>;
  setSelectedCompareModelVersionIds: Dispatch<SetStateAction<string[]>>;
  setSelectedValidationModelVersionId: Dispatch<SetStateAction<string | null>>;
  onRunValidation: () => void;
  onRunModelCompare: () => void;
  onRunAiClinic: () => void;
  onExpandAiClinic: () => void;
  onRunRoiPreview: () => void | Promise<void>;
  onRunLesionPreview: () => void | Promise<void>;
  displayVisitReference: (visitReference: string) => string;
  aiClinicTextUnavailableLabel: string;
};

export function CaseWorkspaceAnalysisSection({
  locale,
  token,
  selectedSiteId,
  mounted,
  analysisEyebrow,
  analysisTitle,
  analysisDescription,
  imageCountLabel,
  commonLoading,
  commonNotAvailable,
  hasSelectedCase,
  canRunRoiPreview,
  canRunValidation,
  canRunAiClinic,
  selectedCaseImageCount,
  representativePreviewUrl,
  selectedCompareModelVersionIds,
  selectedValidationModelVersionId,
  compareModelCandidates,
  validationBusy,
  validationResult,
  validationArtifacts,
  modelCompareBusy,
  modelCompareResult,
  aiClinicBusy,
  aiClinicExpandedBusy,
  aiClinicResult,
  aiClinicPreviewBusy,
  hasAnySavedLesionBox,
  roiPreviewBusy,
  lesionPreviewBusy,
  roiPreviewItems,
  lesionPreviewItems,
  pickLabel,
  translateOption,
  setToast,
  setSelectedCompareModelVersionIds,
  setSelectedValidationModelVersionId,
  onRunValidation,
  onRunModelCompare,
  onRunAiClinic,
  onExpandAiClinic,
  onRunRoiPreview,
  onRunLesionPreview,
  displayVisitReference,
  aiClinicTextUnavailableLabel,
}: AnalysisSectionProps) {
  const validationPredictedConfidence = predictedClassConfidence(
    validationResult?.summary.predicted_label,
    validationResult?.summary.prediction_probability,
  );
  const validationConfidence = confidencePercent(validationPredictedConfidence);
  const validationConfidenceTone = confidenceTone(validationConfidence);
  const canExpandAiClinic =
    canRunAiClinic &&
    aiClinicResult !== null &&
    aiClinicResult.analysis_stage !== "expanded";
  const hasResolvedValidationArtifacts = Boolean(
    validationArtifacts.roi_crop ||
      validationArtifacts.gradcam ||
      validationArtifacts.gradcam_cornea ||
      validationArtifacts.gradcam_lesion ||
      validationArtifacts.medsam_mask ||
      validationArtifacts.lesion_crop ||
      validationArtifacts.lesion_mask,
  );
  const hasReportedValidationArtifacts = Boolean(
    validationResult &&
      Object.values(validationResult.artifact_availability ?? {}).some(Boolean),
  );
  const validationArtifactEmptyMessage = useMemo(() => {
    if (!validationResult || hasResolvedValidationArtifacts) {
      return null;
    }

    const cropMode = String(validationResult.model_version.crop_mode || "")
      .trim()
      .toLowerCase();
    const architecture = String(validationResult.model_version.architecture || "")
      .trim()
      .toLowerCase();
    const caseAggregation = String(
      validationResult.summary.case_aggregation ??
        validationResult.model_version.case_aggregation ??
        "",
    )
      .trim()
      .toLowerCase();
    const usesMilModel =
      architecture.includes("mil") || caseAggregation.includes("mil");
    const usesAttentionAggregation = caseAggregation.includes("attention");

    if (!hasReportedValidationArtifacts) {
      if (cropMode === "raw" && (usesMilModel || usesAttentionAggregation)) {
        return pick(
          locale,
          "This run finished normally. It used a raw visit-level MIL model, so the saved result includes the prediction and confidence but not crop or Grad-CAM review images.",
          "이번 실행은 정상 완료됐습니다. raw visit-level MIL 모델을 사용해서 저장된 결과에는 예측과 신뢰도는 있지만 crop 또는 Grad-CAM 검토 이미지는 생성되지 않았습니다.",
        );
      }
      if (cropMode === "raw") {
        return pick(
          locale,
          "This run finished normally. Raw-image mode saved the prediction and confidence, but this model did not generate extra crop or Grad-CAM review images.",
          "이번 실행은 정상 완료됐습니다. raw 이미지 모드라 예측과 신뢰도는 저장됐지만 추가 crop 또는 Grad-CAM 검토 이미지는 생성되지 않았습니다.",
        );
      }
      if (usesMilModel) {
        return pick(
          locale,
          "This run finished normally. This MIL model saved the prediction and confidence, but it does not currently export extra review images for this case.",
          "이번 실행은 정상 완료됐습니다. 이 MIL 모델은 예측과 신뢰도는 저장하지만, 현재 이 케이스에 대해 추가 검토 이미지를 내보내지 않습니다.",
        );
      }
      return pick(
        locale,
        "This run finished normally, but this model setup did not generate extra crop or Grad-CAM review images for this case.",
        "이번 실행은 정상 완료됐지만, 이 모델 설정에서는 이 케이스에 대한 추가 crop 또는 Grad-CAM 검토 이미지가 생성되지 않았습니다.",
      );
    }

    return pick(
      locale,
      "This run finished and reported review artifacts, but the images could not be loaded in this panel. Try running it again if you need fresh artifacts.",
      "이번 실행은 완료됐고 검토 아티팩트도 보고됐지만, 이 패널에서 이미지를 불러오지 못했습니다. 새 아티팩트가 필요하면 다시 실행해 보세요.",
    );
  }, [
    hasReportedValidationArtifacts,
    hasResolvedValidationArtifacts,
    locale,
    validationResult,
  ]);

  const handleToggleModelVersion = useCallback(
    (versionId: string, checked: boolean) => {
      const normalizedVersionId = String(versionId || "").trim();
      if (!normalizedVersionId) {
        return;
      }
      const current = Array.from(
        new Set(
          selectedCompareModelVersionIds
            .map((item) => String(item).trim())
            .filter((item) => item.length > 0),
        ),
      );
      if (!checked) {
        setSelectedCompareModelVersionIds(
          current.filter((item) => item !== normalizedVersionId),
        );
        return;
      }
      if (current.includes(normalizedVersionId)) {
        return;
      }
      if (current.length >= MAX_MODEL_COMPARE_SELECTIONS) {
        setToast({
          tone: "error",
          message: pick(
            locale,
            `You can compare up to ${MAX_MODEL_COMPARE_SELECTIONS} models at once.`,
            `한 번에 최대 ${MAX_MODEL_COMPARE_SELECTIONS}개 모델까지 비교할 수 있습니다.`,
          ),
        });
        return;
      }
      setSelectedCompareModelVersionIds([...current, normalizedVersionId]);
    },
    [
      locale,
      selectedCompareModelVersionIds,
      setSelectedCompareModelVersionIds,
      setToast,
    ],
  );

  const artifactContent = useMemo(
    () => (
      <ValidationArtifactStack
        locale={locale}
        representativePreviewUrl={representativePreviewUrl}
        roiCropUrl={validationArtifacts.roi_crop}
        gradcamUrl={validationArtifacts.gradcam}
        gradcamCorneaUrl={validationArtifacts.gradcam_cornea}
        gradcamLesionUrl={validationArtifacts.gradcam_lesion}
        medsamMaskUrl={validationArtifacts.medsam_mask}
        lesionCropUrl={validationArtifacts.lesion_crop}
        lesionMaskUrl={validationArtifacts.lesion_mask}
        emptyMessage={validationArtifactEmptyMessage}
      />
    ),
    [
      locale,
      representativePreviewUrl,
      validationArtifactEmptyMessage,
      validationArtifacts.gradcam,
      validationArtifacts.gradcam_cornea,
      validationArtifacts.gradcam_lesion,
      validationArtifacts.lesion_crop,
      validationArtifacts.lesion_mask,
      validationArtifacts.medsam_mask,
      validationArtifacts.roi_crop,
    ],
  );

  const [activeReviewStep, setActiveReviewStep] =
    useState<AnalysisReviewStep>("judgment");
  const compareCandidatesAvailable = compareModelCandidates.length > 0;
  const successfulCompareCount = useMemo(
    () =>
      (modelCompareResult?.comparisons ?? []).filter(
        (item) => item.summary && !item.error,
      ).length,
    [modelCompareResult],
  );
  const aiClinicSimilarCount = aiClinicResult?.similar_cases.length ?? 0;

  const handleShowJudgmentDetails = useCallback(
    () => setActiveReviewStep("judgment"),
    [],
  );
  const handleShowAgreementDetails = useCallback(
    () => setActiveReviewStep("agreement"),
    [],
  );
  const handleShowAiClinicDetails = useCallback(
    () => setActiveReviewStep("ai_clinic"),
    [],
  );
  const handleRunValidationFromHub = useCallback(() => {
    setActiveReviewStep("judgment");
    onRunValidation();
  }, [onRunValidation]);
  const handleRunModelCompareFromHub = useCallback(() => {
    setActiveReviewStep("agreement");
    onRunModelCompare();
  }, [onRunModelCompare]);
  const handleRunAiClinicFromHub = useCallback(() => {
    setActiveReviewStep("ai_clinic");
    onRunAiClinic();
  }, [onRunAiClinic]);
  const handleExpandAiClinicFromHub = useCallback(() => {
    setActiveReviewStep("ai_clinic");
    onExpandAiClinic();
  }, [onExpandAiClinic]);

  const analysisHubContent = useMemo(() => {
    const judgmentActionEnabled = hasSelectedCase && canRunValidation;
    const agreementActionEnabled =
      hasSelectedCase &&
      canRunValidation &&
      compareCandidatesAvailable &&
      selectedCompareModelVersionIds.length > 0;
    const aiClinicActionEnabled = canRunAiClinic;
    const executionBlockedDetail = pick(
      locale,
      "This account can open saved cases, but AI execution is disabled. Use a researcher, site admin, or admin account to run judgment and AI Clinic steps.",
      "이 계정은 저장 케이스를 열 수 있지만 AI 실행 권한은 없습니다. 단일 판정과 AI Clinic 실행에는 researcher, site admin, 또는 admin 계정을 사용하세요.",
    );

    const judgmentStatus = !hasSelectedCase
      ? {
          tone: "blocked" as const,
          label: pick(locale, "Open a case first", "먼저 케이스 열기"),
          detail: pick(
            locale,
            "Saved-case judgment starts after you open a patient case.",
            "저장 케이스를 연 뒤 단일 케이스 판정을 시작할 수 있습니다.",
          ),
        }
      : !canRunValidation
        ? {
            tone: "blocked" as const,
            label: pick(locale, "Execution locked", "실행 권한 없음"),
            detail: executionBlockedDetail,
          }
      : validationBusy
        ? {
            tone: "running" as const,
            label: pick(locale, "Running", "실행 중"),
            detail: pick(
              locale,
              "Creating the single-case judgment and any review images.",
              "단일 케이스 판정과 검토 이미지를 생성하고 있습니다.",
            ),
          }
        : validationResult
          ? {
              tone: "complete" as const,
              label: pick(locale, "Judgment ready", "판정 완료"),
              detail: pick(
                locale,
                `${validationResult.summary.predicted_label} · ${formatProbability(validationPredictedConfidence, commonNotAvailable)} · ${validationResult.summary.validation_id}`,
                `${validationResult.summary.predicted_label} · ${formatProbability(validationPredictedConfidence, commonNotAvailable)} · ${validationResult.summary.validation_id}`,
              ),
            }
          : {
              tone: "ready" as const,
              label: pick(locale, "Ready to run", "실행 준비"),
              detail: pick(
                locale,
                "Run Step 1 to save the AI call, confidence, and review images.",
                "1단계를 실행하면 AI 판정, 신뢰도, 검토 이미지가 저장됩니다.",
              ),
            };

    const agreementStatus = !hasSelectedCase
      ? {
          tone: "blocked" as const,
          label: pick(locale, "Open a case first", "먼저 케이스 열기"),
          detail: pick(
            locale,
            "Agreement checks need an opened saved case.",
            "합의 확인은 저장된 케이스를 연 뒤 사용할 수 있습니다.",
          ),
        }
      : !canRunValidation
        ? {
            tone: "blocked" as const,
            label: pick(locale, "Execution locked", "실행 권한 없음"),
            detail: executionBlockedDetail,
          }
      : !compareCandidatesAvailable
        ? {
            tone: "waiting" as const,
            label: pick(locale, "Loading models", "모델 불러오는 중"),
            detail: pick(
              locale,
              "Ready comparison models will appear here automatically.",
              "준비된 비교 모델이 자동으로 채워질 때까지 잠시 기다리세요.",
            ),
          }
        : selectedCompareModelVersionIds.length === 0
          ? {
              tone: validationResult ? ("waiting" as const) : ("waiting" as const),
              label: pick(locale, "Choose models", "비교 모델 선택 필요"),
              detail: pick(
                locale,
                "Pick one or more prepared models below before running the agreement check.",
                "합의 확인을 실행하기 전에 아래에서 준비된 모델을 하나 이상 고르세요.",
              ),
            }
        : modelCompareBusy
          ? {
              tone: "running" as const,
              label: pick(locale, "Checking agreement", "합의 확인 중"),
              detail: pick(
                locale,
                `${selectedCompareModelVersionIds.length} model(s) are being compared on this case.`,
                `${selectedCompareModelVersionIds.length}개 모델을 이 케이스에서 비교하고 있습니다.`,
              ),
            }
          : modelCompareResult
            ? {
                tone: "complete" as const,
                label: pick(locale, "Agreement ready", "합의 결과 준비됨"),
                detail: pick(
                  locale,
                  `${successfulCompareCount} model result(s) are ready to review.`,
                  `${successfulCompareCount}개 모델 결과를 확인할 수 있습니다.`,
                ),
              }
            : {
                tone: validationResult ? ("ready" as const) : ("waiting" as const),
                label: validationResult
                  ? pick(locale, "Ready to compare", "비교 준비")
                  : pick(locale, "Recommended after Step 1", "1단계 후 권장"),
                detail: pick(
                  locale,
                  `${selectedCompareModelVersionIds.length} model(s) selected for agreement check.`,
                  `${selectedCompareModelVersionIds.length}개 모델이 합의 확인 대상으로 선택되어 있습니다.`,
                ),
              };

    const aiClinicStatus = !hasSelectedCase
      ? {
          tone: "blocked" as const,
          label: pick(locale, "Open a case first", "먼저 케이스 열기"),
          detail: pick(
            locale,
            "Similar-patient review starts after you open a saved case.",
            "유사 환자 검토는 저장된 케이스를 연 뒤 시작할 수 있습니다.",
          ),
        }
      : !canRunValidation
        ? {
            tone: "blocked" as const,
            label: pick(locale, "Execution locked", "실행 권한 없음"),
            detail: executionBlockedDetail,
          }
      : !validationResult
        ? {
            tone: "waiting" as const,
            label: pick(locale, "Run Step 1 first", "먼저 1단계 실행"),
            detail: pick(
              locale,
              "AI Clinic uses the single-case judgment as its anchor.",
              "AI Clinic은 단일 케이스 판정을 기준으로 시작합니다.",
            ),
          }
        : aiClinicBusy
          ? {
              tone: "running" as const,
              label: pick(locale, "Finding similar patients", "유사 환자 찾는 중"),
              detail: pick(
                locale,
                "Retrieval is running for similar patients and cluster position.",
                "유사 환자 검색과 클러스터 위치 계산을 진행하고 있습니다.",
              ),
            }
          : aiClinicExpandedBusy
            ? {
                tone: "running" as const,
                label: pick(locale, "Loading guidance", "가이드 불러오는 중"),
                detail: pick(
                  locale,
                  "Expanding the report with evidence and workflow guidance.",
                  "근거와 workflow guidance를 추가로 불러오고 있습니다.",
                ),
              }
            : aiClinicResult?.analysis_stage === "expanded"
              ? {
                  tone: "complete" as const,
                  label: pick(locale, "Guidance ready", "가이드 준비됨"),
                  detail: pick(
                    locale,
                    `${aiClinicSimilarCount} similar patient(s) plus expanded guidance are ready.`,
                    `${aiClinicSimilarCount}개 유사 환자와 확장 가이드를 확인할 수 있습니다.`,
                  ),
                }
              : aiClinicResult
                ? {
                    tone: "complete" as const,
                    label: pick(locale, "Similar patients ready", "유사 환자 준비됨"),
                    detail: pick(
                      locale,
                      `${aiClinicSimilarCount} similar patient(s) and the 3D cluster view are ready.`,
                      `${aiClinicSimilarCount}개 유사 환자와 3D 클러스터 보기를 확인할 수 있습니다.`,
                    ),
                  }
                : {
                    tone: "ready" as const,
                    label: pick(locale, "Ready to search", "검색 준비"),
                    detail: pick(
                      locale,
                      "Find similar patients first, then load extra guidance only if needed.",
                      "먼저 유사 환자를 찾고, 필요할 때만 추가 가이드를 불러오세요.",
                    ),
                  };

    return (
      <Card as="section" variant="panel" className="grid gap-4 p-5">
        <SectionHeader
          className={docSectionHeadClass}
          eyebrow={
            <div className={docSectionLabelClass}>
              {pick(locale, "What to click first", "먼저 무엇을 누를지")}
            </div>
          }
          title={pick(locale, "Recommended review order", "추천 검토 순서")}
          titleAs="h4"
          description={pick(
            locale,
            "Use these three cards as the review hub. Progress, action buttons, and the currently opened step all stay here.",
            "이 3개 카드를 검토 허브로 사용하세요. 진행 상태, 실행 버튼, 현재 열어둔 단계가 여기에서 바로 보입니다.",
          )}
        />
        <div className="grid gap-3 xl:grid-cols-3">
          <Card
            as="article"
            variant="nested"
            className={`grid gap-3 p-4 ${
              activeReviewStep === "judgment"
                ? "border-brand/28 bg-[rgba(48,88,255,0.06)]"
                : ""
            }`}
          >
            <button
              type="button"
              className="grid gap-3 rounded-[10px] p-1 text-left transition hover:bg-white/45 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(48,88,255,0.12)]"
              onClick={handleShowJudgmentDetails}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="grid gap-1">
                  <div className={docSectionLabelClass}>
                    {pick(locale, "Step 1", "1단계")}
                  </div>
                  <strong className="text-base font-semibold text-ink">
                    {pick(locale, "Single-case judgment", "단일 케이스 판정")}
                  </strong>
                </div>
                {activeReviewStep === "judgment" ? (
                  <span className={docSectionLabelClass}>
                    {pick(locale, "Open now", "현재 열림")}
                  </span>
                ) : null}
              </div>
              <p className="m-0 text-sm leading-6 text-muted">
                {pick(
                  locale,
                  "Save the AI call, confidence, and image-based review artifacts for this case.",
                  "이 케이스의 AI 판정, 신뢰도, 이미지 기반 검토 아티팩트를 저장합니다.",
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                <span
                  className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold ${reviewStepStatusToneClass(
                    judgmentStatus.tone,
                  )}`}
                >
                  {judgmentStatus.label}
                </span>
              </div>
              <p className="m-0 text-sm leading-6 text-muted">
                {judgmentStatus.detail}
              </p>
            </button>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="primary"
                className="min-w-[11.5rem] justify-center"
                onClick={handleRunValidationFromHub}
                disabled={validationBusy || !judgmentActionEnabled}
              >
                {validationBusy
                  ? pick(locale, "Running...", "실행 중...")
                  : !judgmentActionEnabled
                    ? pick(locale, "Execution unavailable", "실행 불가")
                  : pick(locale, "Run single-case judgment", "단일 케이스 판정 실행")}
              </Button>
            </div>
          </Card>

          <Card
            as="article"
            variant="nested"
            className={`grid gap-3 p-4 ${
              activeReviewStep === "agreement"
                ? "border-brand/28 bg-[rgba(48,88,255,0.06)]"
                : ""
            }`}
          >
            <button
              type="button"
              className="grid gap-3 rounded-[10px] p-1 text-left transition hover:bg-white/45 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(48,88,255,0.12)]"
              onClick={handleShowAgreementDetails}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="grid gap-1">
                  <div className={docSectionLabelClass}>
                    {pick(locale, "Step 2", "2단계")}
                  </div>
                  <strong className="text-base font-semibold text-ink">
                    {pick(locale, "Model agreement check", "모델 간 합의 확인")}
                  </strong>
                </div>
                {activeReviewStep === "agreement" ? (
                  <span className={docSectionLabelClass}>
                    {pick(locale, "Open now", "현재 열림")}
                  </span>
                ) : null}
              </div>
              <p className="m-0 text-sm leading-6 text-muted">
                {pick(
                  locale,
                  "Review whether the selected models converge on the same answer for this case.",
                  "선택한 모델들이 이 케이스에서 같은 결론을 내리는지 확인합니다.",
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                <span
                  className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold ${reviewStepStatusToneClass(
                    agreementStatus.tone,
                  )}`}
                >
                  {agreementStatus.label}
                </span>
              </div>
              <p className="m-0 text-sm leading-6 text-muted">
                {agreementStatus.detail}
              </p>
            </button>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="primary"
                className="min-w-[11.5rem] justify-center"
                onClick={handleRunModelCompareFromHub}
                disabled={modelCompareBusy || !agreementActionEnabled}
              >
                {modelCompareBusy
                  ? pick(locale, "Checking...", "확인 중...")
                  : !agreementActionEnabled
                    ? pick(locale, "Execution unavailable", "실행 불가")
                  : pick(locale, "Check model agreement", "모델 합의 확인")}
              </Button>
            </div>
          </Card>

          <Card
            as="article"
            variant="nested"
            className={`grid gap-3 p-4 ${
              activeReviewStep === "ai_clinic"
                ? "border-brand/28 bg-[rgba(48,88,255,0.06)]"
                : ""
            }`}
          >
            <button
              type="button"
              className="grid gap-3 rounded-[10px] p-1 text-left transition hover:bg-white/45 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(48,88,255,0.12)]"
              onClick={handleShowAiClinicDetails}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="grid gap-1">
                  <div className={docSectionLabelClass}>
                    {pick(locale, "Step 3", "3단계")}
                  </div>
                  <strong className="text-base font-semibold text-ink">
                    {pick(locale, "Similar-patient review", "유사 환자 검토")}
                  </strong>
                </div>
                {activeReviewStep === "ai_clinic" ? (
                  <span className={docSectionLabelClass}>
                    {pick(locale, "Open now", "현재 열림")}
                  </span>
                ) : null}
              </div>
              <p className="m-0 text-sm leading-6 text-muted">
                {pick(
                  locale,
                  "Search similar patients first, then expand into evidence, guidance, and the 3D cluster map.",
                  "먼저 유사 환자를 찾고, 필요하면 근거, 가이드, 3D 클러스터 맵까지 이어서 봅니다.",
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                <span
                  className={`inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold ${reviewStepStatusToneClass(
                    aiClinicStatus.tone,
                  )}`}
                >
                  {aiClinicStatus.label}
                </span>
              </div>
              <p className="m-0 text-sm leading-6 text-muted">
                {aiClinicStatus.detail}
              </p>
            </button>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="primary"
                className="min-w-[11.5rem] justify-center"
                onClick={handleRunAiClinicFromHub}
                disabled={aiClinicBusy || !aiClinicActionEnabled}
              >
                {aiClinicBusy
                  ? pick(locale, "Searching...", "검색 중...")
                  : !aiClinicActionEnabled
                    ? pick(locale, "Execution unavailable", "실행 불가")
                  : pick(locale, "Find similar patients", "비슷한 환자 찾기")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={handleExpandAiClinicFromHub}
                disabled={aiClinicExpandedBusy || !canExpandAiClinic}
              >
                {aiClinicExpandedBusy
                  ? pick(locale, "Loading guidance...", "가이드 불러오는 중...")
                  : pick(locale, "Load evidence & guidance", "근거와 가이드 불러오기")}
              </Button>
            </div>
          </Card>
        </div>
      </Card>
    );
  }, [
    activeReviewStep,
    aiClinicBusy,
    aiClinicExpandedBusy,
    aiClinicResult,
    canExpandAiClinic,
    canRunAiClinic,
    canRunValidation,
    commonNotAvailable,
    compareCandidatesAvailable,
    formatProbability,
    handleExpandAiClinicFromHub,
    handleRunAiClinicFromHub,
    handleRunModelCompareFromHub,
    handleRunValidationFromHub,
    handleShowAiClinicDetails,
    handleShowAgreementDetails,
    handleShowJudgmentDetails,
    hasSelectedCase,
    locale,
    modelCompareBusy,
    modelCompareResult,
    selectedCompareModelVersionIds.length,
    successfulCompareCount,
    validationBusy,
    validationPredictedConfidence,
    validationResult,
  ]);

  const judgmentPanelContent = useMemo(
    () => (
      <ValidationPanel
        locale={locale}
        common={{ notAvailable: commonNotAvailable }}
        view="judgment"
        showStepActions={false}
        validationResult={validationResult}
        validationBusy={validationBusy}
        canRunValidation={canRunValidation}
        hasSelectedCase={hasSelectedCase}
        validationConfidence={validationConfidence}
        validationConfidenceTone={validationConfidenceTone}
        validationPredictedConfidence={validationPredictedConfidence}
        selectedValidationModelVersionId={selectedValidationModelVersionId}
        onRunValidation={onRunValidation}
        onSelectValidationModelVersion={(versionId) =>
          setSelectedValidationModelVersionId(versionId)
        }
        artifactContent={artifactContent}
        modelCompareBusy={modelCompareBusy}
        selectedCompareModelVersionIds={selectedCompareModelVersionIds}
        compareModelCandidates={compareModelCandidates}
        onToggleModelVersion={handleToggleModelVersion}
        onRunModelCompare={onRunModelCompare}
        modelCompareResult={modelCompareResult}
        formatProbability={formatProbability}
      />
    ),
    [
      artifactContent,
      canRunValidation,
      commonNotAvailable,
      compareModelCandidates,
      handleToggleModelVersion,
      locale,
      modelCompareBusy,
      modelCompareResult,
      onRunModelCompare,
      onRunValidation,
      hasSelectedCase,
      selectedCompareModelVersionIds,
      selectedValidationModelVersionId,
      setSelectedValidationModelVersionId,
      validationBusy,
      validationConfidence,
      validationConfidenceTone,
      validationPredictedConfidence,
      validationResult,
    ],
  );

  const agreementPanelContent = useMemo(
    () => (
      <ValidationPanel
        locale={locale}
        common={{ notAvailable: commonNotAvailable }}
        view="agreement"
        showStepActions={false}
        validationResult={validationResult}
        validationBusy={validationBusy}
        canRunValidation={canRunValidation}
        hasSelectedCase={hasSelectedCase}
        validationConfidence={validationConfidence}
        validationConfidenceTone={validationConfidenceTone}
        validationPredictedConfidence={validationPredictedConfidence}
        selectedValidationModelVersionId={selectedValidationModelVersionId}
        onRunValidation={onRunValidation}
        onSelectValidationModelVersion={(versionId) =>
          setSelectedValidationModelVersionId(versionId)
        }
        artifactContent={artifactContent}
        modelCompareBusy={modelCompareBusy}
        selectedCompareModelVersionIds={selectedCompareModelVersionIds}
        compareModelCandidates={compareModelCandidates}
        onToggleModelVersion={handleToggleModelVersion}
        onRunModelCompare={onRunModelCompare}
        modelCompareResult={modelCompareResult}
        formatProbability={formatProbability}
      />
    ),
    [
      artifactContent,
      canRunValidation,
      commonNotAvailable,
      compareModelCandidates,
      handleToggleModelVersion,
      locale,
      modelCompareBusy,
      modelCompareResult,
      onRunModelCompare,
      onRunValidation,
      hasSelectedCase,
      selectedCompareModelVersionIds,
      selectedValidationModelVersionId,
      setSelectedValidationModelVersionId,
      validationBusy,
      validationConfidence,
      validationConfidenceTone,
      validationPredictedConfidence,
      validationResult,
    ],
  );

  const formatMetadataField = useCallback(
    (field: string) => formatAiClinicMetadataField(locale, field),
    [locale],
  );

  const aiClinicPanelContent = useMemo(
    () => (
      <AiClinicPanel
        locale={locale}
        showStepActions={false}
        validationResult={validationResult}
        aiClinicBusy={aiClinicBusy}
        aiClinicExpandedBusy={aiClinicExpandedBusy}
        canRunAiClinic={canRunAiClinic}
        canExpandAiClinic={canExpandAiClinic}
        onRunAiClinic={onRunAiClinic}
        onExpandAiClinic={onExpandAiClinic}
      >
        <AiClinicResult
          locale={locale}
          validationResult={validationResult}
          modelCompareResult={modelCompareResult}
          result={aiClinicResult}
          aiClinicPreviewBusy={aiClinicPreviewBusy}
          aiClinicExpandedBusy={aiClinicExpandedBusy}
          canExpandAiClinic={canExpandAiClinic}
          onExpandAiClinic={onExpandAiClinic}
          notAvailableLabel={commonNotAvailable}
          aiClinicTextUnavailableLabel={aiClinicTextUnavailableLabel}
          displayVisitReference={displayVisitReference}
          formatSemanticScore={formatSemanticScore}
          formatImageQualityScore={formatImageQualityScore}
          formatProbability={formatProbability}
          formatMetadataField={formatMetadataField}
          token={token}
          siteId={selectedSiteId}
        />
      </AiClinicPanel>
    ),
    [
      aiClinicBusy,
      aiClinicExpandedBusy,
      aiClinicPreviewBusy,
      aiClinicResult,
      aiClinicTextUnavailableLabel,
      canExpandAiClinic,
      canRunAiClinic,
      commonNotAvailable,
      displayVisitReference,
      formatMetadataField,
      locale,
      modelCompareResult,
      onExpandAiClinic,
      onRunAiClinic,
      selectedSiteId,
      token,
      validationResult,
    ],
  );

  const selectedAnalysisContent =
    activeReviewStep === "judgment"
      ? judgmentPanelContent
      : activeReviewStep === "agreement"
        ? agreementPanelContent
        : aiClinicPanelContent;

  if (!mounted) {
    return null;
  }

  return (
    <>
      <SavedCasePreviewPanels
        locale={locale}
        commonLoading={commonLoading}
        canRunRoiPreview={canRunRoiPreview}
        selectedCaseImageCount={selectedCaseImageCount}
        hasAnySavedLesionBox={hasAnySavedLesionBox}
        roiPreviewBusy={roiPreviewBusy}
        lesionPreviewBusy={lesionPreviewBusy}
        roiPreviewItems={roiPreviewItems}
        lesionPreviewItems={lesionPreviewItems}
        pick={pickLabel}
        translateOption={translateOption}
        onRunRoiPreview={onRunRoiPreview}
        onRunLesionPreview={onRunLesionPreview}
      />

      <section className={docSectionClass}>
        <SectionHeader
          className={docSectionHeadClass}
          eyebrow={
            <div className={docSectionLabelClass}>{analysisEyebrow}</div>
          }
          title={analysisTitle}
          titleAs="h4"
          description={analysisDescription}
          aside={
            <span
              className={docSiteBadgeClass}
            >{`${selectedCaseImageCount} ${imageCountLabel}`}</span>
          }
        />
        <div className={panelStackClass}>
          {analysisHubContent}
          {selectedAnalysisContent}
        </div>
      </section>
    </>
  );
}

type ContributionSectionProps = {
  locale: Locale;
  selectedCase: CaseSummaryRecord | null;
  completionState: CompletionState | null;
  hospitalValidationCount: number;
  canRunValidation: boolean;
  canContributeSelectedCase: boolean;
  hasValidationResult: boolean;
  researchRegistryEnabled: boolean;
  researchRegistryUserEnrolled: boolean;
  researchRegistryBusy: boolean;
  contributionBusy: boolean;
  contributionResult: CaseContributionResponse | null;
  currentUserPublicAlias: string | null;
  contributionLeaderboard: ContributionLeaderboard | null;
  historyBusy: boolean;
  caseHistory: CaseHistoryResponse | null;
  notAvailableLabel: string;
  formatDateTime: (value: string | null | undefined, emptyLabel: string) => string;
  onJoinResearchRegistry: () => void;
  onIncludeResearchCase: () => void;
  onExcludeResearchCase: () => void;
  onContributeCase: () => void;
};

export function CaseWorkspaceContributionSection({
  locale,
  selectedCase,
  completionState,
  hospitalValidationCount,
  canRunValidation,
  canContributeSelectedCase,
  hasValidationResult,
  researchRegistryEnabled,
  researchRegistryUserEnrolled,
  researchRegistryBusy,
  contributionBusy,
  contributionResult,
  currentUserPublicAlias,
  contributionLeaderboard,
  historyBusy,
  caseHistory,
  notAvailableLabel,
  formatDateTime,
  onJoinResearchRegistry,
  onIncludeResearchCase,
  onExcludeResearchCase,
  onContributeCase,
}: ContributionSectionProps) {
  const selectedCompletion =
    selectedCase &&
    completionState &&
    completionState.patient_id === selectedCase.patient_id &&
    completionState.visit_date === selectedCase.visit_date
      ? completionState
      : null;

  const completionContent = selectedCompletion ? (
    <CompletionCard
      locale={locale}
      completion={selectedCompletion}
      hospitalValidationCount={hospitalValidationCount}
      formatDateTime={(value, emptyLabel = notAvailableLabel) =>
        formatDateTime(value, emptyLabel)
      }
      notAvailableLabel={notAvailableLabel}
    />
  ) : null;

  if (!selectedCase) {
    return null;
  }

  return (
    <ContributionHistoryPanel
      locale={locale}
      selectedCase={selectedCase}
      canRunValidation={canRunValidation}
      canContributeSelectedCase={canContributeSelectedCase}
      hasValidationResult={hasValidationResult}
      researchRegistryEnabled={researchRegistryEnabled}
      researchRegistryUserEnrolled={researchRegistryUserEnrolled}
      researchRegistryBusy={researchRegistryBusy}
      contributionBusy={contributionBusy}
      contributionResult={contributionResult}
      currentUserPublicAlias={currentUserPublicAlias}
      contributionLeaderboard={contributionLeaderboard}
      historyBusy={historyBusy}
      caseHistory={caseHistory}
      onJoinResearchRegistry={onJoinResearchRegistry}
      onIncludeResearchCase={onIncludeResearchCase}
      onExcludeResearchCase={onExcludeResearchCase}
      onContributeCase={onContributeCase}
      completionContent={completionContent}
      formatProbability={formatProbability}
      notAvailableLabel={notAvailableLabel}
    />
  );
}
