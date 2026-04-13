"use client";

import { useCallback, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

import {
  fetchImageSemanticPromptScores,
  type SemanticPromptInputMode,
} from "../../lib/api";
import type { Locale } from "../../lib/i18n";
import type {
  LocalePick,
  SemanticPromptErrorMap,
  SemanticPromptReviewMap,
} from "./shared";

type ToastState = {
  tone: "success" | "error";
  message: string;
} | null;

type Args = {
  locale: Locale;
  token: string;
  selectedSiteId: string | null;
  pick: LocalePick;
  describeError: (error: unknown, fallback: string) => string;
  setToast: Dispatch<SetStateAction<ToastState>>;
  selectSiteForCase: string;
};

export function useCaseWorkspaceSemanticPrompt({
  locale,
  token,
  selectedSiteId,
  pick,
  describeError,
  setToast,
  selectSiteForCase,
}: Args) {
  const [semanticPromptBusyImageId, setSemanticPromptBusyImageId] = useState<
    string | null
  >(null);
  const [semanticPromptReviews, setSemanticPromptReviews] =
    useState<SemanticPromptReviewMap>({});
  const [semanticPromptErrors, setSemanticPromptErrors] =
    useState<SemanticPromptErrorMap>({});
  const [semanticPromptOpenImageIds, setSemanticPromptOpenImageIds] = useState<
    string[]
  >([]);
  const [semanticPromptInputMode, setSemanticPromptInputMode] =
    useState<SemanticPromptInputMode>("source");

  const clearSemanticPromptState = useCallback(() => {
    setSemanticPromptBusyImageId(null);
    setSemanticPromptReviews({});
    setSemanticPromptErrors({});
    setSemanticPromptOpenImageIds([]);
  }, []);

  const handleReviewSemanticPrompts = useCallback(
    async (imageId: string) => {
      if (!selectedSiteId) {
        setToast({ tone: "error", message: selectSiteForCase });
        return;
      }
      if (
        semanticPromptOpenImageIds.includes(imageId) &&
        semanticPromptReviews[imageId]
      ) {
        setSemanticPromptOpenImageIds((current) =>
          current.filter((item) => item !== imageId),
        );
        return;
      }
      if (semanticPromptReviews[imageId]) {
        setSemanticPromptErrors((current) => {
          const next = { ...current };
          delete next[imageId];
          return next;
        });
        setSemanticPromptOpenImageIds((current) =>
          current.includes(imageId) ? current : [...current, imageId],
        );
        return;
      }

      setSemanticPromptBusyImageId(imageId);
      setSemanticPromptErrors((current) => {
        const next = { ...current };
        delete next[imageId];
        return next;
      });
      try {
        const review = await fetchImageSemanticPromptScores(
          selectedSiteId,
          imageId,
          token,
          {
            top_k: 3,
            input_mode: "source",
          },
        );
        setSemanticPromptReviews((current) => ({
          ...current,
          [imageId]: review,
        }));
        setSemanticPromptOpenImageIds((current) =>
          current.includes(imageId) ? current : [...current, imageId],
        );
      } catch (nextError) {
        const fallback = pick(
          locale,
          "BiomedCLIP analysis failed.",
          "BiomedCLIP 분석 실행에 실패했습니다.",
        );
        const message = describeError(nextError, fallback);
        setSemanticPromptErrors((current) => ({
          ...current,
          [imageId]: message,
        }));
        setSemanticPromptOpenImageIds((current) =>
          current.includes(imageId) ? current : [...current, imageId],
        );
        setToast({ tone: "error", message });
      } finally {
        setSemanticPromptBusyImageId((current) =>
          current === imageId ? null : current,
        );
      }
    },
    [
      describeError,
      locale,
      pick,
      selectSiteForCase,
      selectedSiteId,
      semanticPromptOpenImageIds,
      semanticPromptReviews,
      setToast,
      token,
    ],
  );

  return {
    semanticPromptBusyImageId,
    semanticPromptReviews,
    semanticPromptErrors,
    semanticPromptOpenImageIds,
    semanticPromptInputMode,
    setSemanticPromptInputMode,
    clearSemanticPromptState,
    handleReviewSemanticPrompts,
  };
}
