"use client";

import {
  type Dispatch,
  memo,
  type ReactNode,
  useEffect,
  useRef,
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
  CaseWorkspaceAiClinicRunOptions,
  CaseWorkspaceModelCompareRunOptions,
  CaseWorkspaceValidationRunOptions,
  LesionPreviewCard,
  LocalePick,
  RoiPreviewCard,
  SiteModelCatalogState,
  TranslateOption,
} from "./shared";
import { ValidationArtifactStack } from "./validation-artifact-stack";
import { ValidationPanel } from "./validation-panel";
import { countDisplayedAiClinicSimilarCases } from "./case-workspace-ai-clinic-helpers";
import {
  preparedVisitLevelFallbackStatus,
  preferredVisitLevelMilModelVersion,
} from "./case-workspace-core-helpers";
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
  emptySurfaceClass,
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
  modelCatalogState: SiteModelCatalogState;
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
  validationArtifactsBusy?: boolean;
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
  onRunValidation: (
    options?: CaseWorkspaceValidationRunOptions,
  ) => Promise<CaseValidationResponse | null>;
  onRunModelCompare: (
    options?: CaseWorkspaceModelCompareRunOptions,
  ) => Promise<CaseValidationCompareResponse | null>;
  onRunAiClinic: (
    options?: CaseWorkspaceAiClinicRunOptions,
  ) => Promise<AiClinicPreviewResponse | null>;
  onExpandAiClinic: () => void;
  onRunRoiPreview: () => void | Promise<void>;
  onRunLesionPreview: () => void | Promise<void>;
  displayVisitReference: (visitReference: string) => string;
  aiClinicTextUnavailableLabel: string;
};

function CaseWorkspaceAnalysisSectionInner({
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
  modelCatalogState,
  validationBusy,
  validationResult,
  validationArtifacts,
  validationArtifactsBusy = false,
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
  const judgmentPanelRef = useRef<HTMLDivElement | null>(null);
  const agreementPanelRef = useRef<HTMLDivElement | null>(null);
  const aiClinicPanelRef = useRef<HTMLDivElement | null>(null);
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
  const hasGradcamArtifacts = Boolean(
    validationArtifacts.gradcam ||
      validationArtifacts.gradcam_cornea ||
      validationArtifacts.gradcam_lesion,
  );
  const hasReportedValidationArtifacts = Boolean(
    validationResult &&
      Object.values(validationResult.artifact_availability ?? {}).some(Boolean),
  );
  const validationArtifactEmptyMessage = useMemo(() => {
    if (
      !validationResult ||
      hasResolvedValidationArtifacts ||
      validationArtifactsBusy
    ) {
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
    validationArtifactsBusy,
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
        emptyMessage={validationArtifactsBusy ? commonLoading : validationArtifactEmptyMessage}
        compact
      />
    ),
    [
      locale,
      representativePreviewUrl,
      commonLoading,
      validationArtifactEmptyMessage,
      validationArtifactsBusy,
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
  const [hubActionStep, setHubActionStep] =
    useState<AnalysisReviewStep | null>(null);
  const [showSequentialResults, setShowSequentialResults] = useState(false);
  const [fullReviewBusy, setFullReviewBusy] = useState(false);
  const [fullReviewBusyStep, setFullReviewBusyStep] =
    useState<AnalysisReviewStep | null>(null);
  const [aiClinicPanelView, setAiClinicPanelView] = useState<
    "retrieval" | "cluster"
  >("retrieval");
  const compareCandidatesAvailable = compareModelCandidates.length > 0;
  const preferredVisitLevelMilModel = useMemo(
    () => preferredVisitLevelMilModelVersion(compareModelCandidates),
    [compareModelCandidates],
  );
  const successfulCompareCount = useMemo(
    () =>
      (modelCompareResult?.comparisons ?? []).filter(
        (item) => item.summary && !item.error,
      ).length,
    [modelCompareResult],
  );
  const primarySuccessfulComparison = useMemo(
    () =>
      (modelCompareResult?.comparisons ?? []).find(
        (item) => item.summary && !item.error,
      ) ?? null,
    [modelCompareResult],
  );
  const aiClinicSimilarCount = countDisplayedAiClinicSimilarCases(aiClinicResult);
  const milFallbackReady = hasSelectedCase && canRunValidation;
  const visitLevelFallbackStatus = useMemo(
    () =>
      preparedVisitLevelFallbackStatus(locale, {
        milFallbackReady,
        modelCatalogState,
      }),
    [locale, milFallbackReady, modelCatalogState],
  );
  const pendingReviewScrollStepRef = useRef<AnalysisReviewStep | null>(null);

  const requestScrollToReviewStep = useCallback((step: AnalysisReviewStep) => {
    pendingReviewScrollStepRef.current = step;
    const target =
      step === "judgment"
        ? judgmentPanelRef.current
        : step === "agreement"
          ? agreementPanelRef.current
          : aiClinicPanelRef.current;
    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      pendingReviewScrollStepRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (pendingReviewScrollStepRef.current !== activeReviewStep) {
      return;
    }
    const target =
      activeReviewStep === "judgment"
        ? judgmentPanelRef.current
        : activeReviewStep === "agreement"
          ? agreementPanelRef.current
          : aiClinicPanelRef.current;
    if (target && typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      pendingReviewScrollStepRef.current = null;
    }
  }, [activeReviewStep]);

  const handleShowJudgmentDetails = useCallback(
    () => {
      setShowSequentialResults(false);
      setActiveReviewStep("judgment");
      setHubActionStep("judgment");
      requestScrollToReviewStep("judgment");
    },
    [requestScrollToReviewStep],
  );
  const handleShowAgreementDetails = useCallback(
    () => {
      setShowSequentialResults(false);
      setActiveReviewStep("agreement");
      setHubActionStep("agreement");
      requestScrollToReviewStep("agreement");
    },
    [requestScrollToReviewStep],
  );
  const handleShowAiClinicDetails = useCallback(
    () => {
      setShowSequentialResults(false);
      setActiveReviewStep("ai_clinic");
      setHubActionStep("ai_clinic");
      requestScrollToReviewStep("ai_clinic");
    },
    [requestScrollToReviewStep],
  );
  const handleRunValidationFromHub = useCallback(() => {
    setShowSequentialResults(false);
    setActiveReviewStep("judgment");
    setHubActionStep("judgment");
    return onRunValidation({
      selectionProfile: "single_case_review",
    });
  }, [onRunValidation]);
  const handleRunModelCompareFromHub = useCallback(() => {
    setShowSequentialResults(false);
    setActiveReviewStep("agreement");
    setHubActionStep("agreement");
    return onRunModelCompare({
      modelVersionIds: preferredVisitLevelMilModel?.version_id
        ? [preferredVisitLevelMilModel.version_id]
        : undefined,
      preferPreparedMil: true,
    });
  }, [onRunModelCompare, preferredVisitLevelMilModel?.version_id]);
  const handleRunAiClinicFromHub = useCallback(() => {
    setShowSequentialResults(false);
    setActiveReviewStep("ai_clinic");
    setHubActionStep("ai_clinic");
    setAiClinicPanelView("retrieval");
    return onRunAiClinic();
  }, [onRunAiClinic]);
  const handleExpandAiClinicFromHub = useCallback(() => {
    setShowSequentialResults(false);
    setActiveReviewStep("ai_clinic");
    setHubActionStep("ai_clinic");
    setAiClinicPanelView("retrieval");
    onExpandAiClinic();
  }, [onExpandAiClinic]);
  const handleSelectAiClinicRetrievalView = useCallback(() => {
    setActiveReviewStep("ai_clinic");
    setAiClinicPanelView("retrieval");
    requestScrollToReviewStep("ai_clinic");
    if (!aiClinicResult && validationResult && canRunAiClinic && !aiClinicBusy) {
      void onRunAiClinic({ validationResult });
    }
  }, [
    aiClinicBusy,
    aiClinicResult,
    canRunAiClinic,
    onRunAiClinic,
    requestScrollToReviewStep,
    validationResult,
  ]);
  const handleSelectAiClinicClusterView = useCallback(() => {
    setActiveReviewStep("ai_clinic");
    setAiClinicPanelView("cluster");
    requestScrollToReviewStep("ai_clinic");
    if (!aiClinicResult && validationResult && canRunAiClinic && !aiClinicBusy) {
      void onRunAiClinic({ validationResult });
    }
  }, [
    aiClinicBusy,
    aiClinicResult,
    canRunAiClinic,
    onRunAiClinic,
    requestScrollToReviewStep,
    validationResult,
  ]);
  const handleRunFullReviewFromHub = useCallback(async () => {
    if (fullReviewBusy) {
      return;
    }
    setShowSequentialResults(true);
    setFullReviewBusy(true);
    try {
      setActiveReviewStep("judgment");
      requestScrollToReviewStep("judgment");
      setFullReviewBusyStep("judgment");
      const nextValidationResult = await onRunValidation({
        ignoreSelectedModel: true,
        selectionProfile: "single_case_review",
      });
      if (!nextValidationResult) {
        return;
      }

      setActiveReviewStep("agreement");
      requestScrollToReviewStep("agreement");
      setFullReviewBusyStep("agreement");
      const nextModelCompareResult = await onRunModelCompare({
        modelVersionIds: preferredVisitLevelMilModel?.version_id
          ? [preferredVisitLevelMilModel.version_id]
          : undefined,
        executionDevice: nextValidationResult.execution_device,
        preferPreparedMil: true,
      });
      if (!nextModelCompareResult) {
        return;
      }

      setActiveReviewStep("ai_clinic");
      setAiClinicPanelView("cluster");
      requestScrollToReviewStep("ai_clinic");
      setFullReviewBusyStep("ai_clinic");
      await onRunAiClinic({
        validationResult: nextValidationResult,
      });
    } finally {
      setFullReviewBusyStep(null);
      setFullReviewBusy(false);
    }
  }, [
    fullReviewBusy,
    onRunAiClinic,
    onRunModelCompare,
    onRunValidation,
    preferredVisitLevelMilModel?.version_id,
    requestScrollToReviewStep,
  ]);

  const analysisHubContent = useMemo(() => {
    const judgmentActionEnabled = hasSelectedCase && canRunValidation;
    const agreementActionEnabled = hasSelectedCase && canRunValidation;
    const aiClinicActionEnabled = canRunAiClinic;
    const judgmentHubExpanded = hubActionStep === "judgment";
    const agreementHubExpanded = hubActionStep === "agreement";
    const aiClinicHubExpanded = hubActionStep === "ai_clinic";
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
              "Running the image-level model and generating review images.",
              "이미지 레벨 분석과 검토 이미지를 생성하고 있습니다.",
            ),
          }
        : validationResult
          ? {
              tone: "complete" as const,
              label: pick(locale, "Analysis ready", "분석 완료"),
              detail: pick(
                locale,
                `${validationResult.summary.predicted_label} · ${formatProbability(validationPredictedConfidence, commonNotAvailable)}`,
                `${validationResult.summary.predicted_label} · ${formatProbability(validationPredictedConfidence, commonNotAvailable)}`,
              ),
            }
          : {
              tone: "ready" as const,
              label: pick(locale, "Ready to run", "실행 준비"),
              detail: pick(
                locale,
                "Run Step 1 to save the image-level result, confidence, and review images.",
                "1단계를 실행하면 이미지 레벨 결과, 신뢰도, 검토 이미지가 저장됩니다.",
              ),
            };

    const agreementStatus = !hasSelectedCase
      ? {
          tone: "blocked" as const,
          label: pick(locale, "Open a case first", "먼저 케이스 열기"),
          detail: pick(
            locale,
            "The prepared Efficient MIL review needs an opened saved case.",
            "준비된 Efficient MIL 검토는 저장된 케이스를 연 뒤 사용할 수 있습니다.",
          ),
        }
      : !canRunValidation
        ? {
            tone: "blocked" as const,
            label: pick(locale, "Execution locked", "실행 권한 없음"),
            detail: executionBlockedDetail,
          }
      : modelCompareBusy
        ? {
            tone: "running" as const,
            label: pick(locale, "Running Efficient MIL", "Efficient MIL 실행 중"),
            detail: pick(
              locale,
              "The prepared visit-level MIL model is running on this case.",
              "준비된 visit-level MIL 모델을 이 케이스에서 실행하고 있습니다.",
            ),
          }
      : modelCompareResult
        ? {
              tone: "complete" as const,
            label: pick(locale, "Visit-level ready", "방문 레벨 완료"),
            detail: pick(
              locale,
              primarySuccessfulComparison?.summary
                ? `${primarySuccessfulComparison.summary.predicted_label} · ${formatProbability(
                    primarySuccessfulComparison.summary.prediction_probability,
                    commonNotAvailable,
                  )}`
                : `${successfulCompareCount} model result(s) are ready to review.`,
              primarySuccessfulComparison?.summary
                ? `${primarySuccessfulComparison.summary.predicted_label} · ${formatProbability(
                    primarySuccessfulComparison.summary.prediction_probability,
                    commonNotAvailable,
                  )}`
                : `${successfulCompareCount}개 모델 결과를 확인할 수 있습니다.`,
            ),
          }
      : !compareCandidatesAvailable
        ? {
            tone: milFallbackReady ? ("ready" as const) : ("waiting" as const),
            label: visitLevelFallbackStatus.label,
            detail: visitLevelFallbackStatus.detail,
          }
        : !preferredVisitLevelMilModel &&
            selectedCompareModelVersionIds.length === 0
          ? {
              tone: validationResult ? ("waiting" as const) : ("waiting" as const),
              label: pick(locale, "Choose a MIL model", "MIL 모델 선택 필요"),
              detail: pick(
                locale,
                "Pick a prepared visit-level MIL model below before running Step 2.",
                  "2단계를 실행하기 전에 아래에서 준비된 visit-level MIL 모델을 고르세요.",
                ),
              }
        : {
            tone: validationResult ? ("ready" as const) : ("waiting" as const),
            label: validationResult
              ? pick(locale, "Ready to run", "실행 준비")
              : pick(locale, "Recommended after Step 1", "1단계 후 권장"),
            detail: pick(
              locale,
              preferredVisitLevelMilModel?.version_name
                ? `Prepared Efficient MIL: ${preferredVisitLevelMilModel.version_name}.`
                : `${selectedCompareModelVersionIds.length} model(s) selected for Step 2.`,
              preferredVisitLevelMilModel?.version_name
                ? `준비된 Efficient MIL: ${preferredVisitLevelMilModel.version_name}.`
                : `${selectedCompareModelVersionIds.length}개 모델이 2단계 대상으로 선택되어 있습니다.`,
            ),
          };

    const aiClinicStatus = !hasSelectedCase
      ? {
          tone: "blocked" as const,
          label: pick(locale, "Open a case first", "먼저 케이스 열기"),
            detail: pick(
              locale,
              "Image retrieval starts after you open a saved case.",
              "이미지 retrieval은 저장된 케이스를 연 뒤 시작할 수 있습니다.",
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
              "Image retrieval uses the image-level analysis as its anchor.",
              "이미지 retrieval은 이미지 레벨 분석을 기준으로 시작합니다.",
            ),
          }
        : aiClinicBusy
          ? {
              tone: "running" as const,
              label: pick(locale, "Running retrieval", "retrieval 실행 중"),
              detail: pick(
                locale,
                "Image retrieval and cluster preparation are running.",
                "이미지 retrieval과 클러스터 준비를 진행하고 있습니다.",
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
                    label: pick(locale, "Retrieval ready", "retrieval 준비됨"),
                    detail: pick(
                      locale,
                      `${aiClinicSimilarCount} similar case(s) are ready.`,
                      `${aiClinicSimilarCount}개 유사 증례를 확인할 수 있습니다.`,
                    ),
                  }
                : {
                    tone: "ready" as const,
                    label: pick(locale, "Ready to search", "retrieval 준비"),
                    detail: pick(
                      locale,
                      "Run image retrieval first, then load extra guidance only if needed.",
                      "먼저 이미지 retrieval을 실행하고, 필요할 때만 추가 가이드를 불러오세요.",
                    ),
                  };

    return (
      <Card as="section" variant="panel" className="grid gap-3 p-4">
        <SectionHeader
          className={docSectionHeadClass}
          eyebrow={
            <div className={docSectionLabelClass}>
              {pick(locale, "Individual steps", "개별 단계")}
            </div>
          }
          title={pick(locale, "Open or rerun one step", "개별 단계 확인")}
          titleAs="h4"
          description={pick(
            locale,
            'The top "Run steps 1-3" button is the default path. Use these cards only when you want to check or rerun a single step.',
            '상단 "1-3 순차 분석 실행"이 기본 경로입니다. 아래 카드는 특정 단계만 확인하거나 다시 실행할 때만 사용하세요.',
          )}
        />
        <div className="grid gap-3 xl:grid-cols-3">
          <Card
            as="article"
            variant="nested"
            className={`grid gap-2.5 p-3.5 ${
              activeReviewStep === "judgment"
                ? "border-brand/28 bg-[rgba(48,88,255,0.06)]"
                : ""
            }`}
          >
            <button
              type="button"
              className="grid gap-3 rounded-[10px] p-1 text-left transition hover:bg-white/45 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(48,88,255,0.12)]"
              aria-expanded={judgmentHubExpanded}
              onClick={handleShowJudgmentDetails}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="grid gap-1">
                  <div className={docSectionLabelClass}>
                    {pick(locale, "Step 1", "1단계")}
                  </div>
                  <strong className="text-base font-semibold text-ink">
                    {pick(locale, "Image-level analysis", "이미지 레벨 분석")}
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
                  "Save per-image predictions and review images.",
                  "이미지별 예측과 검토 이미지를 저장합니다.",
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
            </button>
            {judgmentHubExpanded ? (
              <div className="grid gap-2">
                <p className="m-0 text-sm leading-6 text-muted">
                  {judgmentStatus.detail}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="min-w-[11.5rem] justify-center"
                  onClick={handleRunValidationFromHub}
                  disabled={fullReviewBusy || validationBusy || !judgmentActionEnabled}
                >
                  {validationBusy
                    ? pick(locale, "Running...", "실행 중...")
                    : !judgmentActionEnabled
                      ? pick(locale, "Execution unavailable", "실행 불가")
                    : pick(locale, "Run image-level analysis", "이미지 레벨 분석 실행")}
                </Button>
              </div>
            ) : null}
          </Card>

          <Card
            as="article"
            variant="nested"
            className={`grid gap-2.5 p-3.5 ${
              activeReviewStep === "agreement"
                ? "border-brand/28 bg-[rgba(48,88,255,0.06)]"
                : ""
            }`}
          >
            <button
              type="button"
              className="grid gap-3 rounded-[10px] p-1 text-left transition hover:bg-white/45 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(48,88,255,0.12)]"
              aria-expanded={agreementHubExpanded}
              onClick={handleShowAgreementDetails}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="grid gap-1">
                  <div className={docSectionLabelClass}>
                    {pick(locale, "Step 2", "2단계")}
                  </div>
                  <strong className="text-base font-semibold text-ink">
                    {pick(locale, "Visit-level analysis (MIL)", "방문 단위 분석 (MIL)")}
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
                  "Run visit-level Efficient MIL for this case.",
                  "이 케이스의 방문 단위 Efficient MIL을 실행합니다.",
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
            </button>
            {agreementHubExpanded ? (
              <div className="grid gap-2">
                <p className="m-0 text-sm leading-6 text-muted">
                  {agreementStatus.detail}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="min-w-[11.5rem] justify-center"
                  onClick={handleRunModelCompareFromHub}
                  disabled={fullReviewBusy || modelCompareBusy || !agreementActionEnabled}
                >
                  {modelCompareBusy
                    ? pick(locale, "Running MIL...", "MIL 실행 중...")
                    : !agreementActionEnabled
                      ? pick(locale, "Execution unavailable", "실행 불가")
                    : pick(locale, "Run visit-level analysis", "방문 단위 분석 실행")}
                </Button>
              </div>
            ) : null}
          </Card>

          <Card
            as="article"
            variant="nested"
            className={`grid gap-2.5 p-3.5 ${
              activeReviewStep === "ai_clinic"
                ? "border-brand/28 bg-[rgba(48,88,255,0.06)]"
                : ""
            }`}
          >
            <button
              type="button"
              className="grid gap-3 rounded-[10px] p-1 text-left transition hover:bg-white/45 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(48,88,255,0.12)]"
              aria-expanded={aiClinicHubExpanded}
              onClick={handleShowAiClinicDetails}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="grid gap-1">
                  <div className={docSectionLabelClass}>
                    {pick(locale, "Step 3", "3단계")}
                  </div>
                  <strong className="text-base font-semibold text-ink">
                    {pick(
                      locale,
                      "Image retrieval",
                      "이미지 retrieval",
                    )}
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
                  "Retrieve three similar images, then load more evidence only if needed.",
                  "유사 이미지 3개를 찾고, 필요하면 근거를 더 불러옵니다.",
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
            </button>
            {aiClinicHubExpanded ? (
              <div className="grid gap-2">
                <p className="m-0 text-sm leading-6 text-muted">
                  {aiClinicStatus.detail}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="min-w-[11.5rem] justify-center"
                  onClick={handleRunAiClinicFromHub}
                  disabled={fullReviewBusy || aiClinicBusy || !aiClinicActionEnabled}
                >
                  {aiClinicBusy
                    ? pick(locale, "Searching...", "retrieval 실행 중...")
                    : !aiClinicActionEnabled
                      ? pick(locale, "Execution unavailable", "실행 불가")
                    : pick(locale, "Run image retrieval", "이미지 retrieval 실행")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={handleExpandAiClinicFromHub}
                  disabled={fullReviewBusy || aiClinicExpandedBusy || !canExpandAiClinic}
                >
                  {aiClinicExpandedBusy
                    ? pick(locale, "Loading guidance...", "가이드 불러오는 중...")
                    : pick(locale, "Load evidence & guidance", "근거와 가이드 불러오기")}
                </Button>
              </div>
            ) : null}
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
    fullReviewBusy,
    handleExpandAiClinicFromHub,
    handleRunAiClinicFromHub,
    handleRunModelCompareFromHub,
    handleRunValidationFromHub,
    handleShowAiClinicDetails,
    handleShowAgreementDetails,
    handleShowJudgmentDetails,
    hasSelectedCase,
    hubActionStep,
    locale,
    modelCatalogState,
    modelCompareBusy,
    modelCompareResult,
    preferredVisitLevelMilModel,
    selectedCompareModelVersionIds.length,
    successfulCompareCount,
    validationBusy,
    validationPredictedConfidence,
    validationResult,
    visitLevelFallbackStatus.detail,
    visitLevelFallbackStatus.label,
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
        modelCatalogState={modelCatalogState}
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
      modelCatalogState,
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
        modelCatalogState={modelCatalogState}
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
      modelCatalogState,
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
        activeView={aiClinicPanelView}
        aiClinicBusy={aiClinicBusy}
        aiClinicExpandedBusy={aiClinicExpandedBusy}
        canRunAiClinic={canRunAiClinic}
        canExpandAiClinic={canExpandAiClinic}
        onRunAiClinic={onRunAiClinic}
        onExpandAiClinic={onExpandAiClinic}
        onSelectRetrievalView={handleSelectAiClinicRetrievalView}
        onSelectClusterView={handleSelectAiClinicClusterView}
      >
        <AiClinicResult
          locale={locale}
          validationResult={validationResult}
          modelCompareResult={modelCompareResult}
          result={aiClinicResult}
          activeView={aiClinicPanelView}
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
      aiClinicPanelView,
      aiClinicTextUnavailableLabel,
      canExpandAiClinic,
      canRunAiClinic,
      commonNotAvailable,
      displayVisitReference,
      formatMetadataField,
      handleSelectAiClinicClusterView,
      handleSelectAiClinicRetrievalView,
      locale,
      modelCompareResult,
      onExpandAiClinic,
      onRunAiClinic,
      selectedSiteId,
      token,
      validationResult,
    ],
  );
  const aiClinicClinicalPanelContent = useMemo(
    () => (
      <AiClinicPanel
        locale={locale}
        showStepActions={false}
        clinicalMode
        validationResult={validationResult}
        activeView={aiClinicPanelView}
        aiClinicBusy={aiClinicBusy}
        aiClinicExpandedBusy={aiClinicExpandedBusy}
        canRunAiClinic={canRunAiClinic}
        canExpandAiClinic={canExpandAiClinic}
        onRunAiClinic={onRunAiClinic}
        onExpandAiClinic={onExpandAiClinic}
        onSelectRetrievalView={handleSelectAiClinicRetrievalView}
        onSelectClusterView={handleSelectAiClinicClusterView}
      >
        <AiClinicResult
          locale={locale}
          validationResult={validationResult}
          modelCompareResult={modelCompareResult}
          result={aiClinicResult}
          clinicalMode
          activeView={aiClinicPanelView}
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
      aiClinicPanelView,
      aiClinicTextUnavailableLabel,
      canExpandAiClinic,
      canRunAiClinic,
      commonNotAvailable,
      displayVisitReference,
      formatMetadataField,
      handleSelectAiClinicClusterView,
      handleSelectAiClinicRetrievalView,
      locale,
      modelCompareResult,
      onExpandAiClinic,
      onRunAiClinic,
      selectedSiteId,
      token,
      validationResult,
    ],
  );
  const sequentialRetrievedCases = useMemo(() => {
    const localCases = aiClinicResult?.local_similar_cases ?? aiClinicResult?.similar_cases ?? [];
    const crossSiteCases = aiClinicResult?.cross_site_similar_cases ?? [];
    return [...localCases, ...crossSiteCases].slice(0, 3);
  }, [
    aiClinicResult?.cross_site_similar_cases,
    aiClinicResult?.local_similar_cases,
    aiClinicResult?.similar_cases,
  ]);
  const sequentialJudgmentContent = useMemo(() => {
    const predictedLabel = validationResult?.summary.predicted_label
      ? translateOption(locale, "cultureCategory", validationResult.summary.predicted_label)
      : commonNotAvailable;
    const confidenceLabel = formatProbability(
      validationPredictedConfidence,
      commonNotAvailable,
    );
    return (
      <Card as="section" variant="panel" className="grid gap-4 p-5">
        <SectionHeader
          className={docSectionHeadClass}
          eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Step 1", "1단계")}</div>}
          title={pick(locale, "Image-level analysis", "이미지 레벨 분석")}
          titleAs="h4"
          description={pick(
            locale,
            "Primary AI impression for the representative image.",
            "대표 이미지 기준 AI 1차 판단입니다.",
          )}
        />
        {validationResult ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Card as="div" variant="nested" className="grid gap-1.5 p-4">
                <span className="text-[0.78rem] font-medium text-muted">
                  {pick(locale, "AI impression", "AI 판단")}
                </span>
                <strong className="text-[1.1rem] font-semibold text-ink">
                  {predictedLabel}
                </strong>
              </Card>
              <Card as="div" variant="nested" className="grid gap-1.5 p-4">
                <span className="text-[0.78rem] font-medium text-muted">
                  {pick(locale, "Confidence", "신뢰도")}
                </span>
                <strong className="text-[1.1rem] font-semibold text-ink">
                  {confidenceLabel}
                </strong>
              </Card>
            </div>
            <Card as="section" variant="nested" className="grid gap-4 p-4">
              <SectionHeader
                className={docSectionHeadClass}
                title={pick(locale, "Grad-CAM and review images", "Grad-CAM과 검토 이미지")}
                titleAs="h4"
                description={pick(
                  locale,
                  "Review the representative image, ROI, and Grad-CAM together.",
                  "대표 이미지, ROI, Grad-CAM을 함께 확인합니다.",
                )}
              />
              {hasGradcamArtifacts ? (
                artifactContent
              ) : (
                <div className={emptySurfaceClass}>
                  {pick(
                    locale,
                    "Grad-CAM is missing in this result. Re-run Step 1 to generate it.",
                    "이번 결과에는 Grad-CAM이 없습니다. 1단계를 다시 실행해 주세요.",
                  )}
                </div>
              )}
            </Card>
          </>
        ) : (
          <div className={emptySurfaceClass}>
            {validationBusy || fullReviewBusyStep === "judgment"
              ? pick(
                  locale,
                  "Step 1 is running. The AI impression and Grad-CAM will appear here.",
                  "1단계를 실행 중입니다. 완료되면 AI 판단과 Grad-CAM이 여기에 표시됩니다.",
                )
              : pick(
                  locale,
                  "Run the sequence to generate the primary AI impression and Grad-CAM.",
                  "순차 분석을 실행하면 AI 판단과 Grad-CAM이 여기에 표시됩니다.",
                )}
          </div>
        )}
      </Card>
    );
  }, [
    artifactContent,
    commonNotAvailable,
    formatProbability,
    fullReviewBusyStep,
    hasGradcamArtifacts,
    locale,
    translateOption,
    validationBusy,
    validationPredictedConfidence,
    validationResult,
  ]);
  const sequentialAgreementContent = useMemo(() => {
    const visitLevelLabel = primarySuccessfulComparison?.summary?.predicted_label
      ? translateOption(locale, "cultureCategory", primarySuccessfulComparison.summary.predicted_label)
      : commonNotAvailable;
    const visitLevelConfidence = formatProbability(
      primarySuccessfulComparison?.summary?.prediction_probability,
      commonNotAvailable,
    );
    const agreementNote =
      validationResult?.summary.predicted_label &&
      primarySuccessfulComparison?.summary?.predicted_label
        ? validationResult.summary.predicted_label ===
          primarySuccessfulComparison.summary.predicted_label
          ? pick(
              locale,
              "Step 1 and Step 2 point to the same organism pattern.",
              "1단계와 2단계가 같은 균종 패턴을 가리킵니다.",
            )
          : pick(
              locale,
              "Step 1 and Step 2 do not point to the same organism pattern.",
              "1단계와 2단계의 균종 패턴이 다릅니다.",
            )
        : pick(
            locale,
            "This is the visit-level summary across the case images.",
            "케이스 전체 이미지를 종합한 방문 단위 판단입니다.",
          );
    return (
      <Card as="section" variant="panel" className="grid gap-4 p-5">
        <SectionHeader
          className={docSectionHeadClass}
          eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Step 2", "2단계")}</div>}
          title={pick(locale, "Visit-level summary", "방문 단위 종합 판단")}
          titleAs="h4"
          description={pick(
            locale,
            "Overall impression from the whole visit.",
            "방문 전체 이미지를 종합한 AI 판단입니다.",
          )}
        />
        {modelCompareResult && primarySuccessfulComparison?.summary ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Card as="div" variant="nested" className="grid gap-1.5 p-4">
                <span className="text-[0.78rem] font-medium text-muted">
                  {pick(locale, "Visit-level impression", "방문 단위 판단")}
                </span>
                <strong className="text-[1.1rem] font-semibold text-ink">
                  {visitLevelLabel}
                </strong>
              </Card>
              <Card as="div" variant="nested" className="grid gap-1.5 p-4">
                <span className="text-[0.78rem] font-medium text-muted">
                  {pick(locale, "Confidence", "신뢰도")}
                </span>
                <strong className="text-[1.1rem] font-semibold text-ink">
                  {visitLevelConfidence}
                </strong>
              </Card>
            </div>
            <div className="rounded-[16px] border border-border bg-surface-muted/45 px-4 py-3 text-sm leading-6 text-muted">
              {agreementNote}
            </div>
          </>
        ) : (
          <div className={emptySurfaceClass}>
            {modelCompareBusy || fullReviewBusyStep === "agreement"
              ? pick(
                  locale,
                  "Step 2 is running. The visit-level summary will appear here.",
                  "2단계를 실행 중입니다. 완료되면 방문 단위 종합 판단이 여기에 표시됩니다.",
                )
              : pick(
                  locale,
                  "Run the sequence to generate the visit-level summary.",
                  "순차 분석을 실행하면 방문 단위 종합 판단이 여기에 표시됩니다.",
                )}
          </div>
        )}
      </Card>
    );
  }, [
    commonNotAvailable,
    formatProbability,
    fullReviewBusyStep,
    locale,
    modelCompareBusy,
    modelCompareResult,
    primarySuccessfulComparison?.summary,
    translateOption,
    validationResult?.summary.predicted_label,
  ]);
  const sequentialAiClinicContent = useMemo(
    () => (
      <Card as="section" variant="panel" className="grid gap-4 p-5">
        <SectionHeader
          className={docSectionHeadClass}
          eyebrow={<div className={docSectionLabelClass}>{pick(locale, "Step 3", "3단계")}</div>}
          title={pick(locale, "Similar cases", "유사 증례")}
          titleAs="h4"
          description={pick(
            locale,
            "Representative similar cases for quick clinical comparison.",
            "빠른 임상 비교를 위한 대표 유사 증례입니다.",
          )}
        />
        {aiClinicResult ? (
          sequentialRetrievedCases.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {sequentialRetrievedCases.map((item, index) => {
                const sourceSite = String(
                  item.source_site_display_name ||
                    item.source_site_hospital_name ||
                    "",
                ).trim();
                return (
                  <Card
                    key={`sequence-retrieval-${item.patient_id}-${item.visit_date}-${index}`}
                    as="article"
                    variant="nested"
                    className="grid gap-3 p-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="grid gap-1">
                        <strong className="text-sm font-semibold text-ink">
                          {pick(locale, `Case ${index + 1}`, `증례 ${index + 1}`)}
                        </strong>
                        <span className="text-xs text-muted">
                          {displayVisitReference(item.visit_date)}
                        </span>
                      </div>
                      <span className="inline-flex min-h-8 items-center rounded-full border border-border bg-surface px-3 text-xs font-semibold text-ink">
                        {pick(locale, "Similarity", "유사도")}{" "}
                        {formatSemanticScore(item.similarity, commonNotAvailable)}
                      </span>
                    </div>
                    {item.preview_url ? (
                      <div className="overflow-hidden rounded-[16px] border border-border/70 bg-surface">
                        <img
                          src={item.preview_url}
                          alt={pick(locale, `${item.patient_id} representative image`, `${item.patient_id} 대표 이미지`)}
                          className="aspect-[4/3] w-full object-cover"
                          loading={index === 0 ? "eager" : "lazy"}
                          decoding="async"
                        />
                      </div>
                    ) : null}
                    <div className="grid gap-2 text-sm leading-6 text-muted">
                      <div>
                        <strong className="mr-2 text-ink">
                          {pick(locale, "Culture", "배양")}
                        </strong>
                        {translateOption(locale, "cultureCategory", item.culture_category)}
                        {item.culture_species ? ` / ${item.culture_species}` : ""}
                      </div>
                      <div>
                        <strong className="mr-2 text-ink">
                          {pick(locale, "View", "촬영")}
                        </strong>
                        {translateOption(locale, "view", item.representative_view ?? "white")}
                      </div>
                      {sourceSite ? (
                        <div>
                          <strong className="mr-2 text-ink">
                            {pick(locale, "Source", "기관")}
                          </strong>
                          {sourceSite}
                        </div>
                      ) : null}
                    </div>
                  </Card>
                );
              })}
            </div>
          ) : (
            <div className={emptySurfaceClass}>
              {pick(
                locale,
                "No similar case was returned for this run.",
                "이번 실행에서는 표시할 유사 증례가 없었습니다.",
              )}
            </div>
          )
        ) : (
          <div className={emptySurfaceClass}>
            {aiClinicBusy || fullReviewBusyStep === "ai_clinic"
              ? pick(
                  locale,
                  "Step 3 is running. Similar cases will appear here.",
                  "3단계를 실행 중입니다. 완료되면 유사 증례가 여기에 표시됩니다.",
                )
              : pick(
                  locale,
                  "Run the sequence to retrieve similar cases.",
                  "순차 분석을 실행하면 유사 증례가 여기에 표시됩니다.",
                )}
          </div>
        )}
      </Card>
    ),
    [
      aiClinicBusy,
      aiClinicResult,
      commonNotAvailable,
      displayVisitReference,
      formatSemanticScore,
      fullReviewBusyStep,
      locale,
      sequentialRetrievedCases,
      translateOption,
    ],
  );
  const activeReviewPanelContent = useMemo(() => {
    if (activeReviewStep === "judgment") {
      return judgmentPanelContent;
    }
    if (activeReviewStep === "agreement") {
      return agreementPanelContent;
    }
    return aiClinicPanelContent;
  }, [
    activeReviewStep,
    agreementPanelContent,
    aiClinicPanelContent,
    judgmentPanelContent,
  ]);

  if (!mounted) {
    return null;
  }

  return (
    <>
      <section className={docSectionClass}>
        <div className="grid gap-4 rounded-[22px] border border-border/70 bg-surface-muted/30 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="grid min-w-0 gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className={docSectionLabelClass}>{analysisEyebrow}</div>
              <span
                className={docSiteBadgeClass}
              >{`${selectedCaseImageCount} ${imageCountLabel}`}</span>
            </div>
            <h4 className="m-0 min-w-0 break-words text-[clamp(1.7rem,3vw,2.65rem)] font-semibold leading-[0.98] tracking-[-0.045em] text-ink [overflow-wrap:anywhere]">
              {analysisTitle}
            </h4>
            <p className="m-0 max-w-3xl break-words text-sm leading-6 text-muted [overflow-wrap:anywhere]">
              {analysisDescription}
            </p>
          </div>
          <div className="grid gap-2 rounded-[18px] border border-border/70 bg-surface px-4 py-4 shadow-[0_10px_28px_rgba(15,23,42,0.04)] lg:min-w-[280px]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className={docSectionLabelClass}>
                {pick(locale, "Recommended", "권장")}
              </span>
              <span className="text-xs font-medium text-muted">
                {pick(locale, "Default path", "기본 경로")}
              </span>
            </div>
            <Button
              type="button"
              size="md"
              variant="primary"
              className="min-h-[3.5rem] rounded-[18px] px-6 text-base shadow-[0_20px_40px_rgba(48,88,255,0.24)]"
              onClick={handleRunFullReviewFromHub}
              aria-label={pick(locale, "Run steps 1-3", "1-3 순차 분석 실행")}
              disabled={
                fullReviewBusy ||
                validationBusy ||
                modelCompareBusy ||
                aiClinicBusy ||
                aiClinicExpandedBusy ||
                !(hasSelectedCase && canRunValidation)
              }
            >
              {fullReviewBusy
                ? fullReviewBusyStep === "judgment"
                  ? pick(locale, "Running Step 1...", "1단계 실행 중...")
                  : fullReviewBusyStep === "agreement"
                    ? pick(locale, "Running Step 2...", "2단계 실행 중...")
                    : pick(locale, "Running Step 3...", "3단계 실행 중...")
                : pick(locale, "Run steps 1-3", "1-3 순차 분석 실행")}
            </Button>
            <p className="m-0 text-sm leading-5 text-muted">
              {pick(
                locale,
                "Runs Steps 1 -> 2 -> 3 automatically.",
                "1 -> 2 -> 3 단계를 자동으로 실행합니다.",
              )}
            </p>
          </div>
        </div>
        <div className={panelStackClass}>
          {analysisHubContent}
          {showSequentialResults ? (
            <div className="grid gap-4 rounded-[28px] border border-brand/18 bg-brand-soft/20 p-2">
              <div ref={judgmentPanelRef}>{sequentialJudgmentContent}</div>
              <div ref={agreementPanelRef}>{sequentialAgreementContent}</div>
              <div ref={aiClinicPanelRef}>{aiClinicClinicalPanelContent}</div>
            </div>
          ) : (
            <div
              ref={
                activeReviewStep === "judgment"
                  ? judgmentPanelRef
                  : activeReviewStep === "agreement"
                    ? agreementPanelRef
                    : aiClinicPanelRef
              }
              className={`grid gap-4 ${
                activeReviewStep
                  ? "rounded-[28px] border border-brand/18 bg-brand-soft/20 p-2"
                  : ""
              }`}
            >
              {activeReviewPanelContent}
            </div>
          )}
        </div>
      </section>

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
    </>
  );
}

type ContributionSectionProps = {
  locale: Locale;
  mounted: boolean;
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

function CaseWorkspaceContributionSectionInner({
  locale,
  mounted,
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
  if (!mounted) {
    return null;
  }
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

export const CaseWorkspaceAnalysisSection = memo(
  CaseWorkspaceAnalysisSectionInner,
);

export const CaseWorkspaceContributionSection = memo(
  CaseWorkspaceContributionSectionInner,
);
