"use client";

import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useMemo,
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
      />
    ),
    [
      locale,
      representativePreviewUrl,
      validationArtifacts.gradcam,
      validationArtifacts.gradcam_cornea,
      validationArtifacts.gradcam_lesion,
      validationArtifacts.lesion_crop,
      validationArtifacts.lesion_mask,
      validationArtifacts.medsam_mask,
      validationArtifacts.roi_crop,
    ],
  );

  const validationPanelContent = useMemo(
    () => (
      <ValidationPanel
        locale={locale}
        common={{ notAvailable: commonNotAvailable }}
        validationResult={validationResult}
        validationBusy={validationBusy}
        canRunValidation={canRunValidation}
        hasSelectedCase={hasSelectedCase}
        validationConfidence={validationConfidence}
        validationConfidenceTone={validationConfidenceTone}
        validationPredictedConfidence={validationPredictedConfidence}
        onRunValidation={onRunValidation}
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
      selectedCaseImageCount,
      selectedCompareModelVersionIds,
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
          {validationPanelContent}
          {aiClinicPanelContent}
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
