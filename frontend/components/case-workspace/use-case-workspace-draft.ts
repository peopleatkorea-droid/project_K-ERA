"use client";

import { useEffect, useRef, useState } from "react";

import type { OrganismRecord } from "../../lib/api";

type DraftImage = {
  draft_id: string;
  file: File;
  preview_url: string;
  view: string;
  is_representative: boolean;
};

type DraftState = {
  patient_id: string;
  chart_alias: string;
  local_case_code: string;
  sex: string;
  age: string;
  actual_visit_date: string;
  follow_up_number: string;
  culture_category: string;
  culture_species: string;
  additional_organisms: OrganismRecord[];
  contact_lens_use: string;
  visit_status: string;
  is_initial_visit: boolean;
  predisposing_factor: string[];
  other_history: string;
  intake_completed: boolean;
};

type PersistedDraft = {
  draft: DraftState;
  updated_at: string;
};

type ToastState = {
  tone: "success" | "error";
  message: string;
} | null;

type Args = {
  selectedSiteId: string | null;
  userId: string;
  recoveredDraftMessage: string;
  cultureSpecies: Record<string, string[]>;
  setToast: (toast: ToastState) => void;
  createDraft: () => DraftState;
  normalizeRecoveredDraft: (draft: DraftState) => DraftState;
  hasDraftContent: (draft: DraftState) => boolean;
  draftStorageKey: (userId: string, siteId: string) => string;
  favoriteStorageKey: (userId: string, siteId: string) => string;
};

export function useCaseWorkspaceDraftState({
  selectedSiteId,
  userId,
  recoveredDraftMessage,
  cultureSpecies,
  setToast,
  createDraft,
  normalizeRecoveredDraft,
  hasDraftContent,
  draftStorageKey,
  favoriteStorageKey,
}: Args) {
  const [draft, setDraft] = useState<DraftState>(() => createDraft());
  const [pendingOrganism, setPendingOrganism] = useState<OrganismRecord>({
    culture_category: "bacterial",
    culture_species: cultureSpecies.bacterial[0],
  });
  const [showAdditionalOrganismForm, setShowAdditionalOrganismForm] = useState(false);
  const [draftImages, setDraftImages] = useState<DraftImage[]>([]);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [favoriteCaseIds, setFavoriteCaseIds] = useState<string[]>([]);
  const draftImagesRef = useRef<DraftImage[]>([]);

  useEffect(() => {
    draftImagesRef.current = draftImages;
  }, [draftImages]);

  useEffect(() => {
    return () => {
      for (const image of draftImagesRef.current) {
        URL.revokeObjectURL(image.preview_url);
      }
    };
  }, []);

  useEffect(() => {
    if (!selectedSiteId) {
      setDraft(createDraft());
      setPendingOrganism({
        culture_category: "bacterial",
        culture_species: cultureSpecies.bacterial[0],
      });
      setShowAdditionalOrganismForm(false);
      setDraftSavedAt(null);
      setFavoriteCaseIds([]);
      return;
    }

    const rawDraft = window.localStorage.getItem(draftStorageKey(userId, selectedSiteId));
    const rawFavorites = window.localStorage.getItem(favoriteStorageKey(userId, selectedSiteId));
    try {
      const parsedFavorites = rawFavorites ? (JSON.parse(rawFavorites) as string[]) : [];
      setFavoriteCaseIds(Array.isArray(parsedFavorites) ? parsedFavorites : []);
    } catch {
      window.localStorage.removeItem(favoriteStorageKey(userId, selectedSiteId));
      setFavoriteCaseIds([]);
    }

    if (!rawDraft) {
      setDraft(createDraft());
      setPendingOrganism({
        culture_category: "bacterial",
        culture_species: cultureSpecies.bacterial[0],
      });
      setShowAdditionalOrganismForm(false);
      setDraftSavedAt(null);
      replaceDraftImages([]);
      return;
    }

    try {
      const parsed = JSON.parse(rawDraft) as PersistedDraft;
      setDraft(
        normalizeRecoveredDraft({
          ...createDraft(),
          ...parsed.draft,
        })
      );
      setPendingOrganism({
        culture_category: "bacterial",
        culture_species: cultureSpecies.bacterial[0],
      });
      setShowAdditionalOrganismForm(false);
      setDraftSavedAt(parsed.updated_at);
      replaceDraftImages([]);
      setToast({
        tone: "success",
        message: recoveredDraftMessage,
      });
    } catch {
      window.localStorage.removeItem(draftStorageKey(userId, selectedSiteId));
      setDraft(createDraft());
      setPendingOrganism({
        culture_category: "bacterial",
        culture_species: cultureSpecies.bacterial[0],
      });
      setShowAdditionalOrganismForm(false);
      setDraftSavedAt(null);
      replaceDraftImages([]);
    }
  }, [selectedSiteId, userId]);

  useEffect(() => {
    if (!selectedSiteId) {
      return;
    }
    window.localStorage.setItem(favoriteStorageKey(userId, selectedSiteId), JSON.stringify(favoriteCaseIds));
  }, [favoriteCaseIds, selectedSiteId, userId]);

  useEffect(() => {
    if (!selectedSiteId) {
      return;
    }

    const storageKey = draftStorageKey(userId, selectedSiteId);
    if (!hasDraftContent(draft)) {
      window.localStorage.removeItem(storageKey);
      setDraftSavedAt(null);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      const payload: PersistedDraft = {
        draft,
        updated_at: new Date().toISOString(),
      };
      window.localStorage.setItem(storageKey, JSON.stringify(payload));
      setDraftSavedAt(payload.updated_at);
    }, 450);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [draft, selectedSiteId, userId]);

  function replaceDraftImages(nextImages: DraftImage[]) {
    const nextIds = new Set(nextImages.map((image) => image.draft_id));
    for (const current of draftImagesRef.current) {
      if (!nextIds.has(current.draft_id)) {
        URL.revokeObjectURL(current.preview_url);
      }
    }
    setDraftImages(nextImages);
  }

  function clearDraftStorage(siteId: string | null = selectedSiteId) {
    if (!siteId) {
      setDraftSavedAt(null);
      return;
    }
    window.localStorage.removeItem(draftStorageKey(userId, siteId));
    setDraftSavedAt(null);
  }

  return {
    draft,
    setDraft,
    pendingOrganism,
    setPendingOrganism,
    showAdditionalOrganismForm,
    setShowAdditionalOrganismForm,
    draftImages,
    setDraftImages,
    draftSavedAt,
    favoriteCaseIds,
    setFavoriteCaseIds,
    replaceDraftImages,
    clearDraftStorage,
  };
}
