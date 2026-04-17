"use client";

import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import {
  fetchImagePreviewUrl,
  runCaseAiClinic,
  runCaseAiClinicSimilarCases,
  type CaseSummaryRecord,
  type CaseValidationResponse,
} from "../../lib/api";
import {
  withAiClinicSimilarCasePreviews,
} from "./case-workspace-ai-clinic-helpers";
import type {
  AiClinicPreviewResponse,
  CaseWorkspaceAiClinicRunOptions,
} from "./shared";

type ToastState = {
  tone: "success" | "error";
  message: string;
} | null;

type AiClinicCopy = {
  selectSavedCaseForValidation: string;
  selectValidationBeforeAiClinic: string;
  aiClinicReady: (count: number) => string;
  aiClinicExpandedReady: string;
  aiClinicFailed: string;
  aiClinicExpandFirst: string;
};

type Args = {
  token: string;
  selectedSiteId: string | null;
  selectedCase: CaseSummaryRecord | null;
  validationResult: CaseValidationResponse | null;
  executionModeFromDevice: (
    device: string | undefined,
  ) => "auto" | "cpu" | "gpu";
  describeError: (error: unknown, fallback: string) => string;
  setToast: Dispatch<SetStateAction<ToastState>>;
  setPanelOpen: Dispatch<SetStateAction<boolean>>;
  copy: AiClinicCopy;
};

function revokeUrls(urls: string[]) {
  for (const url of urls) {
    if (String(url).startsWith("blob:")) {
      URL.revokeObjectURL(url);
    }
  }
}

export function useCaseWorkspaceAiClinic({
  token,
  selectedSiteId,
  selectedCase,
  validationResult,
  executionModeFromDevice,
  describeError,
  setToast,
  setPanelOpen,
  copy,
}: Args) {
  const AI_CLINIC_DEFAULT_RETRIEVAL_BACKEND = "dinov2" as const;
  const AI_CLINIC_DEFAULT_RETRIEVAL_PROFILE = "dinov2_lesion_crop" as const;
  const [aiClinicBusy, setAiClinicBusy] = useState(false);
  const [aiClinicExpandedBusy, setAiClinicExpandedBusy] = useState(false);
  const [aiClinicPreviewBusy, setAiClinicPreviewBusy] = useState(false);
  const [aiClinicResult, setAiClinicResult] =
    useState<AiClinicPreviewResponse | null>(null);

  const aiClinicPreviewUrlsRef = useRef<string[]>([]);
  const aiClinicRequestRef = useRef(0);
  const aiClinicPreviewRequestRef = useRef(0);

  const clearAiClinicPreview = useCallback(() => {
    aiClinicRequestRef.current += 1;
    aiClinicPreviewRequestRef.current += 1;
    revokeUrls(aiClinicPreviewUrlsRef.current);
    aiClinicPreviewUrlsRef.current = [];
    setAiClinicBusy(false);
    setAiClinicPreviewBusy(false);
    setAiClinicExpandedBusy(false);
    setAiClinicResult(null);
  }, []);

  const hydrateAiClinicSimilarCasePreviews = useCallback(
    async (
      cases: AiClinicPreviewResponse["similar_cases"],
      previewRequestId: number,
    ) => {
      if (!selectedSiteId) {
        return;
      }
      const casesNeedingPreview = cases.filter(
        (item) => item.representative_image_id && !item.preview_url,
      );
      if (casesNeedingPreview.length === 0) {
        if (aiClinicPreviewRequestRef.current === previewRequestId) {
          setAiClinicPreviewBusy(false);
        }
        return;
      }

      setAiClinicPreviewBusy(true);
      const nextUrls: string[] = [];
      try {
        const resolvedCases = await Promise.all(
          cases.map(async (item) => {
            if (!item.representative_image_id || item.preview_url) {
              return item;
            }
            try {
              const previewUrl = await fetchImagePreviewUrl(
                selectedSiteId,
                item.representative_image_id,
                token,
                {
                  maxSide: 384,
                },
              );
              if (previewUrl) {
                nextUrls.push(previewUrl);
              }
              return {
                ...item,
                preview_url: previewUrl,
              };
            } catch {
              return {
                ...item,
                preview_url: null,
              };
            }
          }),
        );
        if (aiClinicPreviewRequestRef.current !== previewRequestId) {
          revokeUrls(nextUrls);
          return;
        }
        aiClinicPreviewUrlsRef.current.push(...nextUrls);
        startTransition(() => {
          setAiClinicResult((current) => {
            if (!current) {
              return current;
            }
            return { ...current, similar_cases: resolvedCases };
          });
        });
      } finally {
        if (aiClinicPreviewRequestRef.current === previewRequestId) {
          setAiClinicPreviewBusy(false);
        }
      }
    },
    [selectedSiteId, token],
  );

  useEffect(() => {
    return () => revokeUrls(aiClinicPreviewUrlsRef.current);
  }, []);

  useEffect(() => {
    if (validationResult) {
      return;
    }
    clearAiClinicPreview();
  }, [clearAiClinicPreview, validationResult]);

  const handleRunAiClinic = useCallback(
    async (options?: CaseWorkspaceAiClinicRunOptions) => {
      const anchorValidationResult =
        options?.validationResult ?? validationResult ?? null;
      if (!selectedSiteId || !selectedCase) {
        setToast({ tone: "error", message: copy.selectSavedCaseForValidation });
        return null;
      }
      if (!anchorValidationResult) {
        setToast({
          tone: "error",
          message: copy.selectValidationBeforeAiClinic,
        });
        return null;
      }

      clearAiClinicPreview();
      setAiClinicBusy(true);
      setPanelOpen(true);
      const requestId = aiClinicRequestRef.current;
      try {
        const result = await runCaseAiClinicSimilarCases(selectedSiteId, token, {
          patient_id: selectedCase.patient_id,
          visit_date: selectedCase.visit_date,
          execution_mode: executionModeFromDevice(
            anchorValidationResult.execution_device,
          ),
          model_version_id: anchorValidationResult.model_version.version_id,
          top_k: 3,
          retrieval_backend: AI_CLINIC_DEFAULT_RETRIEVAL_BACKEND,
          retrieval_profile: AI_CLINIC_DEFAULT_RETRIEVAL_PROFILE,
        });
        if (aiClinicRequestRef.current !== requestId) {
          return null;
        }
        const nextResult = withAiClinicSimilarCasePreviews(result, null);
        const previewRequestId = aiClinicPreviewRequestRef.current;
        startTransition(() => {
          setAiClinicResult(nextResult);
        });
        setToast({
          tone: "success",
          message: copy.aiClinicReady(nextResult.similar_cases.length),
        });
        void hydrateAiClinicSimilarCasePreviews(
          nextResult.similar_cases,
          previewRequestId,
        );
        return nextResult;
      } catch (nextError) {
        if (aiClinicRequestRef.current === requestId) {
          setToast({
            tone: "error",
            message: describeError(nextError, copy.aiClinicFailed),
          });
        }
        return null;
      } finally {
        if (aiClinicRequestRef.current === requestId) {
          setAiClinicBusy(false);
        }
      }
    },
    [
      clearAiClinicPreview,
      copy.aiClinicFailed,
      copy.aiClinicReady,
      copy.selectSavedCaseForValidation,
      copy.selectValidationBeforeAiClinic,
      describeError,
      executionModeFromDevice,
      hydrateAiClinicSimilarCasePreviews,
      selectedCase,
      selectedSiteId,
      setPanelOpen,
      setToast,
      token,
      validationResult,
    ],
  );

  const handleExpandAiClinic = useCallback(async () => {
    if (!selectedSiteId || !selectedCase) {
      setToast({ tone: "error", message: copy.selectSavedCaseForValidation });
      return;
    }
    if (!validationResult) {
      setToast({ tone: "error", message: copy.selectValidationBeforeAiClinic });
      return;
    }
    if (!aiClinicResult) {
      setToast({ tone: "error", message: copy.aiClinicExpandFirst });
      return;
    }

    const previousResult = aiClinicResult;
    const requestId = aiClinicRequestRef.current + 1;
    aiClinicRequestRef.current = requestId;
    setAiClinicExpandedBusy(true);
    setPanelOpen(true);
    try {
      const result = await runCaseAiClinic(selectedSiteId, token, {
        patient_id: selectedCase.patient_id,
        visit_date: selectedCase.visit_date,
        execution_mode: executionModeFromDevice(
          validationResult.execution_device,
        ),
        model_version_id: validationResult.model_version.version_id,
        top_k: 3,
        retrieval_backend: AI_CLINIC_DEFAULT_RETRIEVAL_BACKEND,
        retrieval_profile: AI_CLINIC_DEFAULT_RETRIEVAL_PROFILE,
      });
      if (aiClinicRequestRef.current !== requestId) {
        return;
      }
      const nextResult = withAiClinicSimilarCasePreviews(
        result,
        previousResult,
      );
      const previewRequestId = aiClinicPreviewRequestRef.current + 1;
      aiClinicPreviewRequestRef.current = previewRequestId;
      startTransition(() => {
        setAiClinicResult(nextResult);
      });
      void hydrateAiClinicSimilarCasePreviews(
        nextResult.similar_cases,
        previewRequestId,
      );
      setToast({
        tone: "success",
        message: copy.aiClinicExpandedReady,
      });
    } catch (nextError) {
      if (aiClinicRequestRef.current === requestId) {
        setToast({
          tone: "error",
          message: describeError(nextError, copy.aiClinicFailed),
        });
      }
    } finally {
      if (aiClinicRequestRef.current === requestId) {
        setAiClinicExpandedBusy(false);
      }
    }
  }, [
    aiClinicResult,
    copy.aiClinicExpandFirst,
    copy.aiClinicExpandedReady,
    copy.aiClinicFailed,
    copy.selectSavedCaseForValidation,
    copy.selectValidationBeforeAiClinic,
    describeError,
    executionModeFromDevice,
    hydrateAiClinicSimilarCasePreviews,
    selectedCase,
    selectedSiteId,
    setPanelOpen,
    setToast,
    token,
    validationResult,
  ]);

  return {
    aiClinicBusy,
    aiClinicExpandedBusy,
    aiClinicPreviewBusy,
    aiClinicResult,
    clearAiClinicPreview,
    handleRunAiClinic,
    handleExpandAiClinic,
  };
}
