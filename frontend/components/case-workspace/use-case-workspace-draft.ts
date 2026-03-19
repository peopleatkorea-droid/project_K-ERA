"use client";

import { useEffect, useRef, useState } from "react";

import type { OrganismRecord } from "../../lib/api";
import {
  deletePersistedDraftAssets,
  readPersistedDraftAssets,
  writePersistedDraftAssets,
} from "../../lib/draft-persistence";

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

type NormalizedBox = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

type LesionBoxMap = Record<string, NormalizedBox | null>;

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
  recoveredDraftWithAssetsMessage: string;
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
  recoveredDraftWithAssetsMessage,
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
  const [draftLesionPromptBoxes, setDraftLesionPromptBoxes] = useState<LesionBoxMap>({});
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [favoriteCaseIds, setFavoriteCaseIds] = useState<string[]>([]);
  const draftImagesRef = useRef<DraftImage[]>([]);

  function defaultPendingOrganism(category = "bacterial"): OrganismRecord {
    const nextCategory = String(category || "bacterial");
    const speciesOptions = cultureSpecies[nextCategory] ?? cultureSpecies.bacterial ?? [];
    return {
      culture_category: nextCategory,
      culture_species: speciesOptions[0] ?? "",
    };
  }

  function pruneLesionBoxes(nextImages: DraftImage[], currentBoxes: LesionBoxMap): LesionBoxMap {
    const nextIds = new Set(nextImages.map((image) => image.draft_id));
    return Object.fromEntries(Object.entries(currentBoxes).filter(([draftId]) => nextIds.has(draftId)));
  }

  function recoverDraftImages(
    persistedImages: Array<{
      draft_id: string;
      name: string;
      type: string;
      last_modified: number;
      view: string;
      is_representative: boolean;
      blob: Blob;
    }>
  ): DraftImage[] {
    return persistedImages.map((image) => {
      const file = new File([image.blob], image.name, {
        type: image.type,
        lastModified: image.last_modified,
      });
      return {
        draft_id: image.draft_id,
        file,
        preview_url: URL.createObjectURL(file),
        view: image.view,
        is_representative: image.is_representative,
      };
    });
  }

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
    let cancelled = false;

    async function loadPersistedDraftState() {
      if (!selectedSiteId) {
        setDraft(createDraft());
        setPendingOrganism(defaultPendingOrganism());
        setShowAdditionalOrganismForm(false);
        setDraftSavedAt(null);
        setFavoriteCaseIds([]);
        setDraftLesionPromptBoxes({});
        replaceDraftImages([]);
        return;
      }

      const storageKey = draftStorageKey(userId, selectedSiteId);
      const rawDraft = window.localStorage.getItem(storageKey);
      const rawFavorites = window.localStorage.getItem(favoriteStorageKey(userId, selectedSiteId));

      try {
        const parsedFavorites = rawFavorites ? (JSON.parse(rawFavorites) as string[]) : [];
        if (!cancelled) {
          setFavoriteCaseIds(Array.isArray(parsedFavorites) ? parsedFavorites : []);
        }
      } catch {
        window.localStorage.removeItem(favoriteStorageKey(userId, selectedSiteId));
        if (!cancelled) {
          setFavoriteCaseIds([]);
        }
      }

      let persistedAssets = null;
      try {
        persistedAssets = await readPersistedDraftAssets(storageKey);
      } catch {
        persistedAssets = null;
      }

      if (cancelled) {
        return;
      }

      if (!rawDraft) {
        setDraft(createDraft());
        setPendingOrganism(defaultPendingOrganism());
        setShowAdditionalOrganismForm(false);
        setDraftSavedAt(null);
        setDraftLesionPromptBoxes({});
        replaceDraftImages([]);
        if (persistedAssets) {
          void deletePersistedDraftAssets(storageKey);
        }
        return;
      }

      try {
        const parsed = JSON.parse(rawDraft) as PersistedDraft;
        const recoveredDraft = normalizeRecoveredDraft({
          ...createDraft(),
          ...parsed.draft,
        });
        const recoveredImages = persistedAssets ? recoverDraftImages(persistedAssets.images) : [];
        setDraft(recoveredDraft);
        setPendingOrganism(defaultPendingOrganism(recoveredDraft.culture_category));
        setShowAdditionalOrganismForm(false);
        setDraftSavedAt(parsed.updated_at);
        replaceDraftImages(recoveredImages);
        setDraftLesionPromptBoxes(pruneLesionBoxes(recoveredImages, persistedAssets?.lesion_boxes ?? {}));
        setToast({
          tone: "success",
          message: recoveredImages.length > 0 ? recoveredDraftWithAssetsMessage : recoveredDraftMessage,
        });
      } catch {
        window.localStorage.removeItem(storageKey);
        void deletePersistedDraftAssets(storageKey);
        setDraft(createDraft());
        setPendingOrganism(defaultPendingOrganism());
        setShowAdditionalOrganismForm(false);
        setDraftSavedAt(null);
        setDraftLesionPromptBoxes({});
        replaceDraftImages([]);
      }
    }

    void loadPersistedDraftState();

    return () => {
      cancelled = true;
    };
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
    const persistedLesionBoxes = pruneLesionBoxes(draftImages, draftLesionPromptBoxes);
    const shouldKeepDraft = hasDraftContent(draft) || draftImages.length > 0 || Object.keys(persistedLesionBoxes).length > 0;

    if (!shouldKeepDraft) {
      window.localStorage.removeItem(storageKey);
      void deletePersistedDraftAssets(storageKey);
      setDraftSavedAt(null);
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      const payload: PersistedDraft = {
        draft,
        updated_at: new Date().toISOString(),
      };

      window.localStorage.setItem(storageKey, JSON.stringify(payload));

      const persistAssets = async () => {
        try {
          if (draftImages.length > 0 || Object.keys(persistedLesionBoxes).length > 0) {
            await writePersistedDraftAssets({
              storage_key: storageKey,
              updated_at: payload.updated_at,
              lesion_boxes: persistedLesionBoxes,
              images: draftImages.map((image) => ({
                draft_id: image.draft_id,
                name: image.file.name,
                type: image.file.type,
                last_modified: image.file.lastModified,
                view: image.view,
                is_representative: image.is_representative,
                blob: image.file,
              })),
            });
          } else {
            await deletePersistedDraftAssets(storageKey);
          }
        } catch {
          // Local field persistence still succeeds even if the browser blocks IndexedDB.
        }

        if (!cancelled) {
          setDraftSavedAt(payload.updated_at);
        }
      };

      void persistAssets();
    }, 450);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [draft, draftImages, draftLesionPromptBoxes, selectedSiteId, userId]);

  function replaceDraftImages(nextImages: DraftImage[]) {
    const nextIds = new Set(nextImages.map((image) => image.draft_id));
    for (const current of draftImagesRef.current) {
      if (!nextIds.has(current.draft_id)) {
        URL.revokeObjectURL(current.preview_url);
      }
    }
    setDraftLesionPromptBoxes((current) => pruneLesionBoxes(nextImages, current));
    setDraftImages(nextImages);
  }

  function clearDraftStorage(siteId: string | null = selectedSiteId) {
    if (!siteId) {
      setDraftSavedAt(null);
      return;
    }

    const storageKey = draftStorageKey(userId, siteId);
    window.localStorage.removeItem(storageKey);
    void deletePersistedDraftAssets(storageKey);
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
    draftLesionPromptBoxes,
    setDraftLesionPromptBoxes,
    draftSavedAt,
    favoriteCaseIds,
    setFavoriteCaseIds,
    replaceDraftImages,
    clearDraftStorage,
  };
}
