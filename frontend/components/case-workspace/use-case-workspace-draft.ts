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

const EMPTY_DRAFT_ASSET_SIGNATURE = "draft-assets:empty";

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

function serializeDraftBox(box: NormalizedBox | null | undefined): string {
  if (!box) {
    return "null";
  }
  return [box.x0, box.y0, box.x1, box.y1].map((value) => Number(value).toFixed(6)).join(",");
}

export function buildDraftAssetSignature(draftImages: DraftImage[], lesionBoxes: LesionBoxMap): string {
  if (draftImages.length === 0 && Object.keys(lesionBoxes).length === 0) {
    return EMPTY_DRAFT_ASSET_SIGNATURE;
  }

  const imageTokens = draftImages
    .map((image) =>
      [
        image.draft_id,
        image.file.name,
        image.file.size,
        image.file.lastModified,
        image.view,
        image.is_representative ? "1" : "0",
      ].join(":"),
    )
    .sort();

  const boxTokens = Object.entries(lesionBoxes)
    .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
    .map(([draftId, box]) => `${draftId}:${serializeDraftBox(box)}`);

  return JSON.stringify({
    images: imageTokens,
    boxes: boxTokens,
  });
}

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
  function defaultPendingOrganism(category = "bacterial"): OrganismRecord {
    const nextCategory = String(category || "bacterial");
    const speciesOptions = cultureSpecies[nextCategory] ?? cultureSpecies.bacterial ?? [];
    return {
      culture_category: nextCategory,
      culture_species: speciesOptions[0] ?? "",
    };
  }

  function readStoredDraftSnapshot(siteId: string | null): PersistedDraft | null {
    if (!siteId || typeof window === "undefined") {
      return null;
    }
    const rawDraft = window.localStorage.getItem(draftStorageKey(userId, siteId));
    if (!rawDraft) {
      return null;
    }
    try {
      const parsed = JSON.parse(rawDraft) as PersistedDraft;
      return {
        ...parsed,
        draft: normalizeRecoveredDraft({
          ...createDraft(),
          ...parsed.draft,
        }),
      };
    } catch {
      return null;
    }
  }

  function readStoredFavoriteIds(siteId: string | null): string[] {
    if (!siteId || typeof window === "undefined") {
      return [];
    }
    const rawFavorites = window.localStorage.getItem(favoriteStorageKey(userId, siteId));
    if (!rawFavorites) {
      return [];
    }
    try {
      const parsedFavorites = JSON.parse(rawFavorites) as string[];
      return Array.isArray(parsedFavorites) ? parsedFavorites : [];
    } catch {
      return [];
    }
  }

  const initialDraftSnapshotRef = useRef<PersistedDraft | null>(readStoredDraftSnapshot(selectedSiteId));
  const initialFavoriteCaseIdsRef = useRef<string[]>(readStoredFavoriteIds(selectedSiteId));
  const [draft, setDraft] = useState<DraftState>(
    () => initialDraftSnapshotRef.current?.draft ?? createDraft(),
  );
  const [pendingOrganism, setPendingOrganism] = useState<OrganismRecord>(() =>
    defaultPendingOrganism(initialDraftSnapshotRef.current?.draft.culture_category),
  );
  const [showAdditionalOrganismForm, setShowAdditionalOrganismForm] = useState(false);
  const [draftImages, setDraftImages] = useState<DraftImage[]>([]);
  const [draftLesionPromptBoxes, setDraftLesionPromptBoxes] = useState<LesionBoxMap>({});
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(
    () => initialDraftSnapshotRef.current?.updated_at ?? null,
  );
  const [favoriteCaseIds, setFavoriteCaseIds] = useState<string[]>(
    () => initialFavoriteCaseIdsRef.current,
  );
  const draftImagesRef = useRef<DraftImage[]>([]);
  const lastPersistedAssetSignatureRef = useRef<string>(EMPTY_DRAFT_ASSET_SIGNATURE);
  const lastPersistedAssetStorageKeyRef = useRef<string | null>(null);

  function rememberPersistedAssets(storageKey: string, draftImagesForSignature: DraftImage[], lesionBoxes: LesionBoxMap) {
    lastPersistedAssetSignatureRef.current = buildDraftAssetSignature(draftImagesForSignature, lesionBoxes);
    lastPersistedAssetStorageKeyRef.current = storageKey;
  }

  function resetPersistedAssetSnapshot() {
    lastPersistedAssetSignatureRef.current = EMPTY_DRAFT_ASSET_SIGNATURE;
    lastPersistedAssetStorageKeyRef.current = null;
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
        resetPersistedAssetSnapshot();
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

      if (!rawDraft) {
        let persistedAssets = null;
        try {
          persistedAssets = await readPersistedDraftAssets(storageKey);
        } catch {
          persistedAssets = null;
        }

        if (cancelled) {
          return;
        }

        rememberPersistedAssets(storageKey, [], {});
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
        setDraft(recoveredDraft);
        setPendingOrganism(defaultPendingOrganism(recoveredDraft.culture_category));
        setShowAdditionalOrganismForm(false);
        setDraftSavedAt(parsed.updated_at);

        let persistedAssets = null;
        try {
          persistedAssets = await readPersistedDraftAssets(storageKey);
        } catch {
          persistedAssets = null;
        }

        if (cancelled) {
          return;
        }

        const recoveredImages = persistedAssets ? recoverDraftImages(persistedAssets.images) : [];
        const recoveredLesionBoxes = pruneLesionBoxes(recoveredImages, persistedAssets?.lesion_boxes ?? {});
        rememberPersistedAssets(storageKey, recoveredImages, recoveredLesionBoxes);
        replaceDraftImages(recoveredImages);
        setDraftLesionPromptBoxes(recoveredLesionBoxes);
        setToast({
          tone: "success",
          message: recoveredImages.length > 0 ? recoveredDraftWithAssetsMessage : recoveredDraftMessage,
        });
      } catch {
        window.localStorage.removeItem(storageKey);
        void deletePersistedDraftAssets(storageKey);
        resetPersistedAssetSnapshot();
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
    const assetSignature = buildDraftAssetSignature(draftImages, persistedLesionBoxes);
    const shouldPersistAssets = assetSignature !== EMPTY_DRAFT_ASSET_SIGNATURE;
    const assetsChanged =
      lastPersistedAssetStorageKeyRef.current !== storageKey || lastPersistedAssetSignatureRef.current !== assetSignature;

    if (!shouldKeepDraft) {
      window.localStorage.removeItem(storageKey);
      void deletePersistedDraftAssets(storageKey);
      rememberPersistedAssets(storageKey, [], {});
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
      if (!cancelled) {
        setDraftSavedAt(payload.updated_at);
      }

      const persistAssets = async () => {
        try {
          if (shouldPersistAssets) {
            if (!assetsChanged) {
              return;
            }
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
            rememberPersistedAssets(storageKey, draftImages, persistedLesionBoxes);
          } else {
            if (!assetsChanged) {
              return;
            }
            await deletePersistedDraftAssets(storageKey);
            rememberPersistedAssets(storageKey, [], {});
          }
        } catch {
          // Local field persistence still succeeds even if the browser blocks IndexedDB.
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
      resetPersistedAssetSnapshot();
      setDraftSavedAt(null);
      return;
    }

    const storageKey = draftStorageKey(userId, siteId);
    window.localStorage.removeItem(storageKey);
    void deletePersistedDraftAssets(storageKey);
    rememberPersistedAssets(storageKey, [], {});
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
