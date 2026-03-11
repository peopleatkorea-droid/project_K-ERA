"use client";

import { useDeferredValue, useEffect, useRef, useState } from "react";

import {
  type CaseHistoryResponse,
  type CaseContributionResponse,
  type RoiPreviewRecord,
  type SiteActivityResponse,
  type SiteValidationRunRecord,
  createPatient,
  createVisit,
  fetchCaseHistory,
  fetchCaseRoiPreview,
  fetchCaseRoiPreviewArtifactBlob,
  fetchCases,
  fetchImageBlob,
  fetchValidationArtifactBlob,
  fetchImages,
  fetchSiteActivity,
  fetchSiteValidations,
  type AuthUser,
  type CaseSummaryRecord,
  type CaseValidationResponse,
  type ImageRecord,
  type SiteRecord,
  type SiteSummary,
  runSiteValidation,
  runCaseContribution,
  runCaseValidation,
  uploadImage,
} from "../lib/api";

const SEX_OPTIONS = ["female", "male", "other", "unknown"];
const CONTACT_LENS_OPTIONS = [
  "none",
  "soft contact lens",
  "rigid gas permeable",
  "orthokeratology",
  "unknown",
];
const PREDISPOSING_FACTOR_OPTIONS = [
  "trauma",
  "contact lens",
  "ocular surface disease",
  "topical steroid use",
  "post surgery",
  "neurotrophic",
  "unknown",
];
const SMEAR_RESULT_OPTIONS = ["not done", "positive", "negative", "unknown", "other"];
const VISIT_STATUS_OPTIONS = ["active", "improving", "scar"];
const VIEW_OPTIONS = ["white", "slit", "fluorescein"];
const CULTURE_SPECIES: Record<string, string[]> = {
  bacterial: [
    "Staphylococcus aureus",
    "Staphylococcus epidermidis",
    "Streptococcus pneumoniae",
    "Pseudomonas aeruginosa",
    "Moraxella",
    "Nocardia",
    "Other",
  ],
  fungal: ["Fusarium", "Aspergillus", "Candida", "Curvularia", "Alternaria", "Other"],
};

type DraftImage = {
  draft_id: string;
  file: File;
  preview_url: string;
  view: string;
  is_representative: boolean;
};

type SavedImagePreview = ImageRecord & {
  preview_url: string | null;
};

type RoiPreviewCard = RoiPreviewRecord & {
  source_preview_url: string | null;
  roi_crop_url: string | null;
};

type ValidationArtifactKind = "gradcam" | "roi_crop" | "medsam_mask";

type ValidationArtifactPreviews = Partial<Record<ValidationArtifactKind, string | null>>;

type DraftState = {
  patient_id: string;
  chart_alias: string;
  local_case_code: string;
  sex: string;
  age: string;
  visit_date: string;
  culture_category: string;
  culture_species: string;
  contact_lens_use: string;
  visit_status: string;
  smear_result: string;
  polymicrobial: boolean;
  predisposing_factor: string[];
  other_history: string;
};

type PersistedDraft = {
  draft: DraftState;
  updated_at: string;
};

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
};

type ToastState = {
  tone: "success" | "error";
  message: string;
} | null;

type CaseWorkspaceProps = {
  token: string;
  user: AuthUser;
  sites: SiteRecord[];
  selectedSiteId: string | null;
  summary: SiteSummary | null;
  canOpenOperations: boolean;
  onSelectSite: (siteId: string) => void;
  onExportManifest: () => void;
  onLogout: () => void;
  onOpenOperations: () => void;
  onSiteDataChanged: (siteId: string) => Promise<void>;
};

function createDraft(): DraftState {
  return {
    patient_id: "",
    chart_alias: "",
    local_case_code: "",
    sex: "female",
    age: "65",
    visit_date: new Date().toISOString().slice(0, 10),
    culture_category: "bacterial",
    culture_species: CULTURE_SPECIES.bacterial[0],
    contact_lens_use: "none",
    visit_status: "active",
    smear_result: "not done",
    polymicrobial: false,
    predisposing_factor: [],
    other_history: "",
  };
}

function createDraftId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatCaseTitle(caseRecord: CaseSummaryRecord): string {
  return caseRecord.chart_alias || caseRecord.local_case_code || caseRecord.patient_id;
}

function formatProbability(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "n/a";
  }
  return `${Math.round(value * 100)}%`;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "n/a";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function confidencePercent(value: number | null | undefined): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value * 100)));
}

function confidenceTone(percent: number): "high" | "medium" | "low" {
  if (percent >= 80) {
    return "high";
  }
  if (percent >= 60) {
    return "medium";
  }
  return "low";
}

function draftStorageKey(userId: string, siteId: string): string {
  return `kera_workspace_draft:${userId}:${siteId}`;
}

function hasDraftContent(draft: DraftState): boolean {
  const emptyDraft = createDraft();
  return (
    draft.patient_id.trim() !== emptyDraft.patient_id ||
    draft.chart_alias.trim() !== emptyDraft.chart_alias ||
    draft.local_case_code.trim() !== emptyDraft.local_case_code ||
    draft.sex !== emptyDraft.sex ||
    draft.age !== emptyDraft.age ||
    draft.visit_date !== emptyDraft.visit_date ||
    draft.culture_category !== emptyDraft.culture_category ||
    draft.culture_species !== emptyDraft.culture_species ||
    draft.contact_lens_use !== emptyDraft.contact_lens_use ||
    draft.visit_status !== emptyDraft.visit_status ||
    draft.smear_result !== emptyDraft.smear_result ||
    draft.polymicrobial !== emptyDraft.polymicrobial ||
    draft.predisposing_factor.length > 0 ||
    draft.other_history.trim() !== emptyDraft.other_history
  );
}

function executionModeFromDevice(device: string | undefined): "auto" | "cpu" | "gpu" {
  if (device === "cuda") {
    return "gpu";
  }
  if (device === "cpu") {
    return "cpu";
  }
  return "auto";
}

export function CaseWorkspace({
  token,
  user,
  sites,
  selectedSiteId,
  summary,
  canOpenOperations,
  onSelectSite,
  onExportManifest,
  onLogout,
  onOpenOperations,
  onSiteDataChanged,
}: CaseWorkspaceProps) {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [draft, setDraft] = useState<DraftState>(() => createDraft());
  const [draftImages, setDraftImages] = useState<DraftImage[]>([]);
  const [cases, setCases] = useState<CaseSummaryRecord[]>([]);
  const [casesLoading, setCasesLoading] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [selectedCase, setSelectedCase] = useState<CaseSummaryRecord | null>(null);
  const [selectedCaseImages, setSelectedCaseImages] = useState<SavedImagePreview[]>([]);
  const [panelBusy, setPanelBusy] = useState(false);
  const [activityBusy, setActivityBusy] = useState(false);
  const [siteActivity, setSiteActivity] = useState<SiteActivityResponse | null>(null);
  const [siteValidationBusy, setSiteValidationBusy] = useState(false);
  const [siteValidationRuns, setSiteValidationRuns] = useState<SiteValidationRunRecord[]>([]);
  const [validationBusy, setValidationBusy] = useState(false);
  const [validationResult, setValidationResult] = useState<CaseValidationResponse | null>(null);
  const [validationArtifacts, setValidationArtifacts] = useState<ValidationArtifactPreviews>({});
  const [roiPreviewBusy, setRoiPreviewBusy] = useState(false);
  const [roiPreviewItems, setRoiPreviewItems] = useState<RoiPreviewCard[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [caseHistory, setCaseHistory] = useState<CaseHistoryResponse | null>(null);
  const [contributionBusy, setContributionBusy] = useState(false);
  const [contributionResult, setContributionResult] = useState<CaseContributionResponse | null>(null);
  const [completionState, setCompletionState] = useState<CompletionState | null>(null);
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [caseSearch, setCaseSearch] = useState("");
  const [toast, setToast] = useState<ToastState>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const draftImagesRef = useRef<DraftImage[]>([]);
  const validationArtifactUrlsRef = useRef<string[]>([]);
  const roiPreviewUrlsRef = useRef<string[]>([]);
  const deferredSearch = useDeferredValue(caseSearch);

  useEffect(() => {
    draftImagesRef.current = draftImages;
  }, [draftImages]);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem("kera_workspace_theme");
    if (storedTheme === "dark" || storedTheme === "light") {
      setTheme(storedTheme);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("kera_workspace_theme", theme);
  }, [theme]);

  useEffect(() => {
    return () => {
      for (const image of draftImagesRef.current) {
        URL.revokeObjectURL(image.preview_url);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      for (const url of validationArtifactUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      for (const url of roiPreviewUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
    };
  }, []);

  useEffect(() => {
    if (!selectedSiteId) {
      setDraft(createDraft());
      setDraftSavedAt(null);
      return;
    }

    const rawDraft = window.localStorage.getItem(draftStorageKey(user.user_id, selectedSiteId));
    if (!rawDraft) {
      setDraft(createDraft());
      setDraftSavedAt(null);
      replaceDraftImages([]);
      return;
    }

    try {
      const parsed = JSON.parse(rawDraft) as PersistedDraft;
      setDraft({
        ...createDraft(),
        ...parsed.draft,
      });
      setDraftSavedAt(parsed.updated_at);
      replaceDraftImages([]);
      setToast({
        tone: "success",
        message: "Recovered the last saved draft properties for this site. Re-attach image files before saving.",
      });
    } catch {
      window.localStorage.removeItem(draftStorageKey(user.user_id, selectedSiteId));
      setDraft(createDraft());
      setDraftSavedAt(null);
      replaceDraftImages([]);
    }
  }, [selectedSiteId, user.user_id]);

  useEffect(() => {
    if (!selectedSiteId) {
      return;
    }

    const storageKey = draftStorageKey(user.user_id, selectedSiteId);
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
  }, [draft, selectedSiteId, user.user_id]);

  useEffect(() => {
    if (!selectedSiteId) {
      setCases([]);
      setSiteActivity(null);
      setSiteValidationRuns([]);
      setSelectedCase(null);
      setSelectedCaseImages([]);
      return;
    }
    const currentSiteId = selectedSiteId;
    let cancelled = false;
    async function loadCases() {
      setCasesLoading(true);
      try {
        const nextCases = await fetchCases(currentSiteId, token);
        if (cancelled) {
          return;
        }
        setCases(nextCases);
        setSelectedCase((current) => {
          if (!current) {
            return nextCases[0] ?? null;
          }
          return nextCases.find((item) => item.case_id === current.case_id) ?? nextCases[0] ?? null;
        });
      } catch (nextError) {
        if (!cancelled) {
          setToast({
            tone: "error",
            message: nextError instanceof Error ? nextError.message : "Unable to load recent cases.",
          });
        }
      } finally {
        if (!cancelled) {
          setCasesLoading(false);
        }
      }
    }
    async function loadActivity() {
      setActivityBusy(true);
      try {
        const nextActivity = await fetchSiteActivity(currentSiteId, token);
        if (!cancelled) {
          setSiteActivity(nextActivity);
        }
      } catch (nextError) {
        if (!cancelled) {
          setSiteActivity(null);
          setToast({
            tone: "error",
            message: nextError instanceof Error ? nextError.message : "Unable to load site activity.",
          });
        }
      } finally {
        if (!cancelled) {
          setActivityBusy(false);
        }
      }
    }
    async function loadSiteValidations() {
      setSiteValidationBusy(true);
      try {
        const nextRuns = await fetchSiteValidations(currentSiteId, token);
        if (!cancelled) {
          setSiteValidationRuns(nextRuns);
        }
      } catch (nextError) {
        if (!cancelled) {
          setSiteValidationRuns([]);
          setToast({
            tone: "error",
            message: nextError instanceof Error ? nextError.message : "Unable to load site validation history.",
          });
        }
      } finally {
        if (!cancelled) {
          setSiteValidationBusy(false);
        }
      }
    }
    void loadCases();
    void loadActivity();
    void loadSiteValidations();
    return () => {
      cancelled = true;
    };
  }, [selectedSiteId, token]);

  useEffect(() => {
    for (const url of validationArtifactUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    validationArtifactUrlsRef.current = [];
    setValidationArtifacts({});
    clearRoiPreview();
    setValidationResult(null);
    setCaseHistory(null);
    setContributionResult(null);
    if (!selectedSiteId || !selectedCase) {
      setSelectedCaseImages([]);
      return;
    }
    const currentSiteId = selectedSiteId;
    const currentCase = selectedCase;
    let cancelled = false;
    const createdUrls: string[] = [];
    async function loadSelectedCaseImages() {
      setPanelBusy(true);
      try {
        const imageRecords = await fetchImages(currentSiteId, token, currentCase.patient_id, currentCase.visit_date);
        const nextImages = await Promise.all(
          imageRecords.map(async (record) => {
            try {
              const blob = await fetchImageBlob(currentSiteId, record.image_id, token);
              const previewUrl = URL.createObjectURL(blob);
              createdUrls.push(previewUrl);
              return { ...record, preview_url: previewUrl };
            } catch {
              return { ...record, preview_url: null };
            }
          })
        );
        if (!cancelled) {
          setSelectedCaseImages(nextImages);
        }
      } catch (nextError) {
        if (!cancelled) {
          setToast({
            tone: "error",
            message: nextError instanceof Error ? nextError.message : "Unable to load case images.",
          });
          setSelectedCaseImages([]);
        }
      } finally {
        if (!cancelled) {
          setPanelBusy(false);
        }
      }
    }
    async function loadSelectedCaseHistory() {
      setHistoryBusy(true);
      try {
        const nextHistory = await fetchCaseHistory(currentSiteId, currentCase.patient_id, currentCase.visit_date, token);
        if (!cancelled) {
          setCaseHistory(nextHistory);
        }
      } catch (nextError) {
        if (!cancelled) {
          setCaseHistory(null);
          setToast({
            tone: "error",
            message: nextError instanceof Error ? nextError.message : "Unable to load case history.",
          });
        }
      } finally {
        if (!cancelled) {
          setHistoryBusy(false);
        }
      }
    }
    void loadSelectedCaseImages();
    void loadSelectedCaseHistory();
    return () => {
      cancelled = true;
      for (const url of createdUrls) {
        URL.revokeObjectURL(url);
      }
    };
  }, [selectedCase, selectedSiteId, token]);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timeoutId = window.setTimeout(() => {
      setToast(null);
    }, 3200);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [toast]);

  function replaceDraftImages(nextImages: DraftImage[]) {
    const nextIds = new Set(nextImages.map((image) => image.draft_id));
    for (const current of draftImagesRef.current) {
      if (!nextIds.has(current.draft_id)) {
        URL.revokeObjectURL(current.preview_url);
      }
    }
    setDraftImages(nextImages);
  }

  function clearValidationArtifacts() {
    for (const url of validationArtifactUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    validationArtifactUrlsRef.current = [];
    setValidationArtifacts({});
  }

  function clearRoiPreview() {
    for (const url of roiPreviewUrlsRef.current) {
      URL.revokeObjectURL(url);
    }
    roiPreviewUrlsRef.current = [];
    setRoiPreviewItems([]);
  }

  function clearDraftStorage(siteId: string | null = selectedSiteId) {
    if (!siteId) {
      setDraftSavedAt(null);
      return;
    }
    window.localStorage.removeItem(draftStorageKey(user.user_id, siteId));
    setDraftSavedAt(null);
  }

  function resetDraft() {
    replaceDraftImages([]);
    clearDraftStorage();
    clearValidationArtifacts();
    clearRoiPreview();
    setValidationResult(null);
    setCaseHistory(null);
    setContributionResult(null);
    setSelectedCase(null);
    setSelectedCaseImages([]);
    setDraft(createDraft());
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function appendFiles(files: File[]) {
    if (!files.length) {
      return;
    }
    setPanelOpen(true);
    clearValidationArtifacts();
    clearRoiPreview();
    setValidationResult(null);
    setCaseHistory(null);
    setContributionResult(null);
    setSelectedCase(null);
    setSelectedCaseImages([]);
    setDraftImages((current) => {
      const next = [...current];
      const hasRepresentative = current.some((image) => image.is_representative);
      for (const file of files) {
        next.push({
          draft_id: createDraftId(),
          file,
          preview_url: URL.createObjectURL(file),
          view: "white",
          is_representative: false,
        });
      }
      if (!hasRepresentative && next[0]) {
        next[0] = { ...next[0], is_representative: true };
      }
      return next;
    });
  }

  function removeDraftImage(draftId: string) {
    const remaining = draftImages.filter((image) => image.draft_id !== draftId);
    if (remaining.length > 0 && !remaining.some((image) => image.is_representative)) {
      remaining[0] = { ...remaining[0], is_representative: true };
    }
    replaceDraftImages(remaining);
  }

  function setRepresentativeImage(draftId: string) {
    setDraftImages((current) =>
      current.map((image) => ({
        ...image,
        is_representative: image.draft_id === draftId,
      }))
    );
  }

  function updateDraftImageView(draftId: string, view: string) {
    setDraftImages((current) =>
      current.map((image) => (image.draft_id === draftId ? { ...image, view } : image))
    );
  }

  function togglePredisposingFactor(factor: string) {
    setDraft((current) => {
      const exists = current.predisposing_factor.includes(factor);
      return {
        ...current,
        predisposing_factor: exists
          ? current.predisposing_factor.filter((item) => item !== factor)
          : [...current.predisposing_factor, factor],
      };
    });
  }

  async function loadCaseHistory(siteId: string, patientId: string, visitDate: string) {
    setHistoryBusy(true);
    try {
      const nextHistory = await fetchCaseHistory(siteId, patientId, visitDate, token);
      setCaseHistory(nextHistory);
    } catch (nextError) {
      setCaseHistory(null);
      setToast({
        tone: "error",
        message: nextError instanceof Error ? nextError.message : "Unable to load case history.",
      });
    } finally {
      setHistoryBusy(false);
    }
  }

  async function loadSiteActivity(siteId: string) {
    setActivityBusy(true);
    try {
      const nextActivity = await fetchSiteActivity(siteId, token);
      setSiteActivity(nextActivity);
    } catch (nextError) {
      setSiteActivity(null);
      setToast({
        tone: "error",
        message: nextError instanceof Error ? nextError.message : "Unable to load site activity.",
      });
    } finally {
      setActivityBusy(false);
    }
  }

  async function loadSiteValidationRuns(siteId: string) {
    setSiteValidationBusy(true);
    try {
      const nextRuns = await fetchSiteValidations(siteId, token);
      setSiteValidationRuns(nextRuns);
    } catch (nextError) {
      setSiteValidationRuns([]);
      setToast({
        tone: "error",
        message: nextError instanceof Error ? nextError.message : "Unable to load site validation history.",
      });
    } finally {
      setSiteValidationBusy(false);
    }
  }

  async function handleRunRoiPreview() {
    if (!selectedSiteId || !selectedCase) {
      setToast({ tone: "error", message: "Select a saved case before running ROI preview." });
      return;
    }

    setRoiPreviewBusy(true);
    clearRoiPreview();
    setPanelOpen(true);
    try {
      const previews = await fetchCaseRoiPreview(
        selectedSiteId,
        selectedCase.patient_id,
        selectedCase.visit_date,
        token
      );
      const nextItems = await Promise.all(
        previews.map(async (item) => {
          const nextCard: RoiPreviewCard = {
            ...item,
            source_preview_url: null,
            roi_crop_url: null,
          };
          if (item.image_id) {
            try {
              const sourceBlob = await fetchImageBlob(selectedSiteId, item.image_id, token);
              const sourceUrl = URL.createObjectURL(sourceBlob);
              roiPreviewUrlsRef.current.push(sourceUrl);
              nextCard.source_preview_url = sourceUrl;
            } catch {
              nextCard.source_preview_url = null;
            }
            if (item.has_roi_crop) {
              try {
                const roiBlob = await fetchCaseRoiPreviewArtifactBlob(
                  selectedSiteId,
                  selectedCase.patient_id,
                  selectedCase.visit_date,
                  item.image_id,
                  "roi_crop",
                  token
                );
                const roiUrl = URL.createObjectURL(roiBlob);
                roiPreviewUrlsRef.current.push(roiUrl);
                nextCard.roi_crop_url = roiUrl;
              } catch {
                nextCard.roi_crop_url = null;
              }
            }
          }
          return nextCard;
        })
      );
      setRoiPreviewItems(nextItems);
      setToast({
        tone: "success",
        message: `ROI preview generated for ${selectedCase.patient_id} / ${selectedCase.visit_date}.`,
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: nextError instanceof Error ? nextError.message : "ROI preview failed.",
      });
    } finally {
      setRoiPreviewBusy(false);
    }
  }

  async function handleRunSiteValidation() {
    if (!selectedSiteId) {
      setToast({ tone: "error", message: "Select a site before running site validation." });
      return;
    }

    setSiteValidationBusy(true);
    try {
      const result = await runSiteValidation(selectedSiteId, token);
      await onSiteDataChanged(selectedSiteId);
      await loadSiteActivity(selectedSiteId);
      await loadSiteValidationRuns(selectedSiteId);
      setToast({
        tone: "success",
        message: `Site validation saved as ${result.summary.validation_id}.`,
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: nextError instanceof Error ? nextError.message : "Site validation failed.",
      });
    } finally {
      setSiteValidationBusy(false);
    }
  }

  async function handleRunValidation() {
    if (!selectedSiteId || !selectedCase) {
      setToast({ tone: "error", message: "Select a saved case before running validation." });
      return;
    }

    setValidationBusy(true);
    clearValidationArtifacts();
    setValidationResult(null);
    setContributionResult(null);
    setPanelOpen(true);
    try {
      const result = await runCaseValidation(selectedSiteId, token, {
        patient_id: selectedCase.patient_id,
        visit_date: selectedCase.visit_date,
      });
      const nextArtifacts: ValidationArtifactPreviews = {};
      const artifactKinds: ValidationArtifactKind[] = ["roi_crop", "gradcam", "medsam_mask"];

      for (const artifactKind of artifactKinds) {
        const isAvailable =
          artifactKind === "roi_crop"
            ? result.artifact_availability.roi_crop
            : artifactKind === "gradcam"
              ? result.artifact_availability.gradcam
              : result.artifact_availability.medsam_mask;
        if (!isAvailable) {
          continue;
        }
        try {
          const blob = await fetchValidationArtifactBlob(
            selectedSiteId,
            result.summary.validation_id,
            selectedCase.patient_id,
            selectedCase.visit_date,
            artifactKind,
            token
          );
          const url = URL.createObjectURL(blob);
          validationArtifactUrlsRef.current.push(url);
          nextArtifacts[artifactKind] = url;
        } catch {
          nextArtifacts[artifactKind] = null;
        }
      }

      setValidationArtifacts(nextArtifacts);
      setValidationResult(result);
      await onSiteDataChanged(selectedSiteId);
      await loadCaseHistory(selectedSiteId, selectedCase.patient_id, selectedCase.visit_date);
      await loadSiteActivity(selectedSiteId);
      setToast({
        tone: "success",
        message: `Validation saved for ${selectedCase.patient_id} / ${selectedCase.visit_date}.`,
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: nextError instanceof Error ? nextError.message : "Validation failed.",
      });
    } finally {
      setValidationBusy(false);
    }
  }

  async function handleContributeCase() {
    if (!selectedSiteId || !selectedCase) {
      setToast({ tone: "error", message: "Select a saved case before contributing." });
      return;
    }
    if (selectedCase.visit_status !== "active") {
      setToast({
        tone: "error",
        message: "Only active visits are enabled for contribution under the current policy.",
      });
      return;
    }

    setContributionBusy(true);
    setPanelOpen(true);
    try {
      const result = await runCaseContribution(selectedSiteId, token, {
        patient_id: selectedCase.patient_id,
        visit_date: selectedCase.visit_date,
        execution_mode: executionModeFromDevice(validationResult?.execution_device),
        model_version_id: validationResult?.model_version.version_id,
      });
      setContributionResult(result);
      await onSiteDataChanged(selectedSiteId);
      await loadCaseHistory(selectedSiteId, selectedCase.patient_id, selectedCase.visit_date);
      await loadSiteActivity(selectedSiteId);
      setCompletionState({
        kind: "contributed",
        patient_id: selectedCase.patient_id,
        visit_date: selectedCase.visit_date,
        timestamp: new Date().toISOString(),
        stats: {
          user_contributions: result.stats.user_contributions,
          total_contributions: result.stats.total_contributions,
          user_contribution_pct: result.stats.user_contribution_pct,
        },
        update_id: result.update.update_id,
      });
      setToast({
        tone: "success",
        message: `Contribution queued for ${selectedCase.patient_id} / ${selectedCase.visit_date}.`,
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: nextError instanceof Error ? nextError.message : "Contribution failed.",
      });
    } finally {
      setContributionBusy(false);
    }
  }

  async function handleSaveCase() {
    if (!selectedSiteId) {
      setToast({ tone: "error", message: "Select a site before creating a case." });
      return;
    }
    if (!draft.patient_id.trim()) {
      setToast({ tone: "error", message: "Patient ID is required." });
      return;
    }
    if (!draft.visit_date.trim()) {
      setToast({ tone: "error", message: "Visit date is required." });
      return;
    }
    if (!draft.culture_species.trim()) {
      setToast({ tone: "error", message: "Culture species is required." });
      return;
    }
    if (draftImages.length === 0) {
      setToast({ tone: "error", message: "Add at least one slit-lamp image to save this case." });
      return;
    }

    setSaveBusy(true);
    try {
      try {
        await createPatient(selectedSiteId, token, {
          patient_id: draft.patient_id.trim(),
          sex: draft.sex,
          age: Number(draft.age || 0),
          chart_alias: draft.chart_alias.trim(),
          local_case_code: draft.local_case_code.trim(),
        });
      } catch (nextError) {
        const message = nextError instanceof Error ? nextError.message : "Patient creation failed.";
        if (!message.toLowerCase().includes("already exists")) {
          throw nextError;
        }
      }

      await createVisit(selectedSiteId, token, {
        patient_id: draft.patient_id.trim(),
        visit_date: draft.visit_date,
        culture_category: draft.culture_category,
        culture_species: draft.culture_species.trim(),
        contact_lens_use: draft.contact_lens_use,
        predisposing_factor: draft.predisposing_factor,
        other_history: draft.other_history.trim(),
        visit_status: draft.visit_status,
        smear_result: draft.smear_result,
        polymicrobial: draft.polymicrobial,
      });

      for (const image of draftImages) {
        await uploadImage(selectedSiteId, token, {
          patient_id: draft.patient_id.trim(),
          visit_date: draft.visit_date,
          view: image.view,
          is_representative: image.is_representative,
          file: image.file,
        });
      }

      await onSiteDataChanged(selectedSiteId);
      const nextCases = await fetchCases(selectedSiteId, token);
      setCases(nextCases);
      const createdCase = nextCases.find(
        (item) => item.patient_id === draft.patient_id.trim() && item.visit_date === draft.visit_date
      );
      await loadSiteActivity(selectedSiteId);
      setToast({
        tone: "success",
        message: `Case ${draft.patient_id.trim()} / ${draft.visit_date} saved to ${selectedSiteId}.`,
      });
      clearDraftStorage(selectedSiteId);
      resetDraft();
      setSelectedCase(createdCase ?? null);
      setPanelOpen(true);
      setCompletionState({
        kind: "saved",
        patient_id: draft.patient_id.trim(),
        visit_date: draft.visit_date,
        timestamp: new Date().toISOString(),
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: nextError instanceof Error ? nextError.message : "Case save failed.",
      });
    } finally {
      setSaveBusy(false);
    }
  }

  const searchNeedle = deferredSearch.trim().toLowerCase();
  const filteredCases = cases.filter((item) => {
    if (!searchNeedle) {
      return true;
    }
    const haystack = [
      item.patient_id,
      item.chart_alias,
      item.local_case_code,
      item.culture_category,
      item.culture_species,
      item.visit_date,
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(searchNeedle);
  });
  const speciesOptions = CULTURE_SPECIES[draft.culture_category] ?? [];
  const momentumPercent = cases.length === 0 ? 18 : Math.min(100, 18 + cases.length * 12);
  const canRunValidation = ["admin", "site_admin", "researcher"].includes(user.role);
  const canRunRoiPreview = canRunValidation;
  const canContributeSelectedCase =
    canRunValidation && Boolean(selectedCase) && selectedCase?.visit_status === "active";
  const latestSiteValidation = siteValidationRuns[0] ?? null;
  const validationConfidence = confidencePercent(validationResult?.summary.prediction_probability);
  const validationConfidenceTone = confidenceTone(validationConfidence);
  const selectedCompletion =
    selectedCase &&
    completionState &&
    completionState.patient_id === selectedCase.patient_id &&
    completionState.visit_date === selectedCase.visit_date
      ? completionState
      : null;
  const draftStatusLabel = draftSavedAt
    ? `Draft autosaved ${new Date(draftSavedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
    : "Draft is local to this browser until you save the case";

  return (
    <main className="workspace-shell" data-workspace-theme={theme}>
      <div className="workspace-noise" />
      <aside className="workspace-rail">
        <div className="workspace-brand">
          <div>
            <div className="workspace-kicker">Case Studio</div>
            <h1>K-ERA Canvas</h1>
          </div>
          <button className="ghost-button" type="button" onClick={resetDraft}>
            New draft
          </button>
        </div>

        <section className="workspace-card rail-section">
          <div className="rail-section-head">
            <span className="rail-label">Site</span>
            <strong>{sites.length} linked</strong>
          </div>
          <div className="rail-site-list">
            {sites.map((site) => (
              <button
                key={site.site_id}
                className={`rail-site-button ${selectedSiteId === site.site_id ? "active" : ""}`}
                type="button"
                onClick={() => onSelectSite(site.site_id)}
              >
                <strong>{site.display_name}</strong>
                <span>{site.hospital_name || site.site_id}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="workspace-card rail-section">
          <div className="rail-section-head">
            <span className="rail-label">Momentum</span>
            <strong>{cases.length} saved cases</strong>
          </div>
          <div className="momentum-track">
            <div className="momentum-fill" style={{ width: `${momentumPercent}%` }} />
          </div>
          <p className="rail-copy">
            Each saved case expands the local dataset surface and keeps the migration grounded in real workflow.
          </p>
        </section>

        <section className="workspace-card rail-section">
          <div className="rail-section-head">
            <span className="rail-label">Activity</span>
            <strong>{activityBusy ? "syncing" : `${siteActivity?.pending_updates ?? 0} pending`}</strong>
          </div>
          <div className="panel-metric-grid rail-metric-grid">
            <div>
              <strong>{siteActivity?.pending_updates ?? 0}</strong>
              <span>pending deltas</span>
            </div>
            <div>
              <strong>{siteActivity?.recent_validations.length ?? 0}</strong>
              <span>recent validations</span>
            </div>
          </div>
          <div className="rail-activity-list">
            {siteActivity?.recent_validations.slice(0, 2).map((item) => (
              <div key={item.validation_id} className="rail-activity-item">
                <strong>{item.model_version}</strong>
                <span>{formatDateTime(item.run_date)}</span>
                <span>{typeof item.accuracy === "number" ? `acc ${formatProbability(item.accuracy)}` : `${item.n_cases ?? 0} cases`}</span>
              </div>
            ))}
            {siteActivity?.recent_contributions.slice(0, 2).map((item) => (
              <div key={item.contribution_id} className="rail-activity-item">
                <strong>{item.patient_id}</strong>
                <span>{formatDateTime(item.created_at)}</span>
                <span>{item.update_status ?? "queued"}</span>
              </div>
            ))}
            {!activityBusy && !siteActivity?.recent_validations.length && !siteActivity?.recent_contributions.length ? (
              <div className="empty-surface">No site activity recorded yet.</div>
            ) : null}
          </div>
        </section>

        <section className="workspace-card rail-section">
          <div className="rail-section-head">
            <span className="rail-label">Site validation</span>
            <button
              className="ghost-button"
              type="button"
              onClick={() => void handleRunSiteValidation()}
              disabled={siteValidationBusy || !selectedSiteId || !canRunValidation}
            >
              {siteValidationBusy ? "Running..." : "Run site validation"}
            </button>
          </div>
          {latestSiteValidation ? (
            <div className="panel-metric-grid rail-metric-grid">
              <div>
                <strong>{typeof latestSiteValidation.AUROC === "number" ? latestSiteValidation.AUROC.toFixed(3) : "n/a"}</strong>
                <span>AUROC</span>
              </div>
              <div>
                <strong>{typeof latestSiteValidation.accuracy === "number" ? latestSiteValidation.accuracy.toFixed(3) : "n/a"}</strong>
                <span>accuracy</span>
              </div>
              <div>
                <strong>{latestSiteValidation.n_cases ?? 0}</strong>
                <span>cases</span>
              </div>
              <div>
                <strong>{latestSiteValidation.model_version}</strong>
                <span>latest model</span>
              </div>
            </div>
          ) : (
            <div className="empty-surface">No site-level validation has been run yet.</div>
          )}
          <div className="rail-activity-list">
            {siteValidationRuns.slice(0, 3).map((item) => (
              <div key={item.validation_id} className="rail-activity-item">
                <strong>{item.model_version}</strong>
                <span>{formatDateTime(item.run_date)}</span>
                <span>{typeof item.accuracy === "number" ? `acc ${item.accuracy.toFixed(3)}` : `${item.n_cases ?? 0} cases`}</span>
              </div>
            ))}
          </div>
          {!canRunValidation ? <p className="rail-copy">Viewer accounts can review metrics but cannot run site validation.</p> : null}
        </section>

        <section className="workspace-card rail-section rail-case-section">
          <div className="rail-section-head">
            <span className="rail-label">Recent cases</span>
            <strong>{filteredCases.length}</strong>
          </div>
          <input
            className="rail-search"
            value={caseSearch}
            onChange={(event) => setCaseSearch(event.target.value)}
            placeholder="Search patient, alias, species"
          />
          <div className="rail-case-list">
            {casesLoading ? <div className="empty-surface">Loading saved cases...</div> : null}
            {!casesLoading && filteredCases.length === 0 ? (
              <div className="empty-surface">No saved cases for this site yet.</div>
            ) : null}
            {filteredCases.map((item) => (
              <button
                key={item.case_id}
                className={`case-list-item ${selectedCase?.case_id === item.case_id ? "active" : ""}`}
                type="button"
                onClick={() => {
                  setSelectedCase(item);
                  setPanelOpen(true);
                }}
              >
                <div className="case-list-head">
                  <strong>{formatCaseTitle(item)}</strong>
                  <span>{item.image_count} imgs</span>
                </div>
                <div className="case-list-meta">
                  <span>{item.patient_id}</span>
                  <span>{item.visit_date}</span>
                </div>
                <div className="case-list-tagline">
                  {item.culture_category} / {item.culture_species}
                </div>
              </button>
            ))}
          </div>
        </section>
      </aside>

      <section className="workspace-main">
        <header className="workspace-header">
          <div>
            <div className="workspace-kicker">Research document</div>
            <h2>Compose one case as a living page</h2>
            <p>
              Logged in as {user.full_name} ({user.role}). Case authoring, review, and contribution now stay in this
              web workspace while fallback tooling remains internal.
            </p>
          </div>
          <div className="workspace-actions">
            <button className="ghost-button" type="button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </button>
            {canOpenOperations ? (
              <button className="ghost-button" type="button" onClick={onOpenOperations}>
                Operations
              </button>
            ) : null}
            <button className="ghost-button" type="button" onClick={onExportManifest} disabled={!selectedSiteId}>
              Export manifest
            </button>
            <button className="primary-workspace-button" type="button" onClick={onLogout}>
              Log out
            </button>
          </div>
        </header>

        <div className="workspace-center">
          <section className="doc-surface">
            <div className="doc-title-row">
              <div>
                <div className="doc-eyebrow">New case</div>
                <h3>{draft.chart_alias.trim() || draft.patient_id.trim() || "Untitled keratitis case"}</h3>
              </div>
              <div className="doc-site-badge">{selectedSiteId ?? "Select a site"}</div>
            </div>
            <div className="doc-badge-row">
              <span className="doc-site-badge">{draftStatusLabel}</span>
              {draftImages.length > 0 ? <span className="doc-site-badge">Unsaved image files stay in this tab only</span> : null}
            </div>

            <section className="property-grid">
              <label className="property-chip">
                <span>Patient ID</span>
                <input
                  value={draft.patient_id}
                  onChange={(event) => setDraft((current) => ({ ...current, patient_id: event.target.value }))}
                  placeholder="KERA-2026-001"
                />
              </label>
              <label className="property-chip">
                <span>Visit date</span>
                <input
                  type="date"
                  value={draft.visit_date}
                  onChange={(event) => setDraft((current) => ({ ...current, visit_date: event.target.value }))}
                />
              </label>
              <label className="property-chip">
                <span>Category</span>
                <select
                  value={draft.culture_category}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      culture_category: event.target.value,
                      culture_species: (CULTURE_SPECIES[event.target.value] ?? [current.culture_species])[0],
                    }))
                  }
                >
                  {Object.keys(CULTURE_SPECIES).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="property-chip">
                <span>Species</span>
                <select
                  value={draft.culture_species}
                  onChange={(event) => setDraft((current) => ({ ...current, culture_species: event.target.value }))}
                >
                  {speciesOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="property-chip">
                <span>Status</span>
                <select
                  value={draft.visit_status}
                  onChange={(event) => setDraft((current) => ({ ...current, visit_status: event.target.value }))}
                >
                  {VISIT_STATUS_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="property-chip">
                <span>Smear</span>
                <select
                  value={draft.smear_result}
                  onChange={(event) => setDraft((current) => ({ ...current, smear_result: event.target.value }))}
                >
                  {SMEAR_RESULT_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            </section>

            <section className="doc-section">
              <div className="doc-section-head">
                <div>
                  <div className="doc-section-label">Patient identity</div>
                  <h4>Inline profile properties</h4>
                </div>
                <span>{draftImages.length} image blocks</span>
              </div>
              <div className="inline-form-grid">
                <label className="inline-field">
                  <span>Chart alias</span>
                  <input
                    value={draft.chart_alias}
                    onChange={(event) => setDraft((current) => ({ ...current, chart_alias: event.target.value }))}
                    placeholder="Cornea board case"
                  />
                </label>
                <label className="inline-field">
                  <span>Local code</span>
                  <input
                    value={draft.local_case_code}
                    onChange={(event) => setDraft((current) => ({ ...current, local_case_code: event.target.value }))}
                    placeholder="OPH-IK-26-01"
                  />
                </label>
                <label className="inline-field">
                  <span>Sex</span>
                  <select
                    value={draft.sex}
                    onChange={(event) => setDraft((current) => ({ ...current, sex: event.target.value }))}
                  >
                    {SEX_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="inline-field">
                  <span>Age</span>
                  <input
                    type="number"
                    min={0}
                    value={draft.age}
                    onChange={(event) => setDraft((current) => ({ ...current, age: event.target.value }))}
                  />
                </label>
                <label className="inline-field">
                  <span>Contact lens</span>
                  <select
                    value={draft.contact_lens_use}
                    onChange={(event) => setDraft((current) => ({ ...current, contact_lens_use: event.target.value }))}
                  >
                    {CONTACT_LENS_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="inline-field inline-toggle">
                  <span>Polymicrobial</span>
                  <button
                    className={`toggle-pill ${draft.polymicrobial ? "active" : ""}`}
                    type="button"
                    onClick={() => setDraft((current) => ({ ...current, polymicrobial: !current.polymicrobial }))}
                  >
                    {draft.polymicrobial ? "Included" : "Single organism"}
                  </button>
                </label>
              </div>
            </section>
            <section className="doc-section">
              <div className="doc-section-head">
                <div>
                  <div className="doc-section-label">Visit context</div>
                  <h4>Clinical tags instead of rigid steps</h4>
                </div>
              </div>
              <div className="tag-cloud">
                {PREDISPOSING_FACTOR_OPTIONS.map((factor) => (
                  <button
                    key={factor}
                    className={`tag-pill ${draft.predisposing_factor.includes(factor) ? "active" : ""}`}
                    type="button"
                    onClick={() => togglePredisposingFactor(factor)}
                  >
                    {factor}
                  </button>
                ))}
              </div>
              <label className="notes-field">
                <span>Case note</span>
                <textarea
                  rows={5}
                  value={draft.other_history}
                  onChange={(event) => setDraft((current) => ({ ...current, other_history: event.target.value }))}
                  placeholder="Freeform note space for ocular surface context, referral history, or procedural remarks."
                />
              </label>
            </section>

            <section className="doc-section">
              <div className="doc-section-head">
                <div>
                  <div className="doc-section-label">Image board</div>
                  <h4>Drop slit-lamp images into the page</h4>
                </div>
                <button className="ghost-button" type="button" onClick={openFilePicker}>
                  Add files
                </button>
              </div>
              <div
                className="drop-surface"
                onClick={openFilePicker}
                onDragOver={(event) => {
                  event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  appendFiles(Array.from(event.dataTransfer.files));
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(event) => appendFiles(Array.from(event.target.files ?? []))}
                />
                <div className="drop-copy">
                  <strong>Drag and drop corneal images here</strong>
                  <span>Images stay local until you save this case into the selected site workspace.</span>
                </div>
              </div>

              {draftImages.length > 0 ? (
                <div className="image-grid">
                  {draftImages.map((image) => (
                    <article key={image.draft_id} className="image-card">
                      <div className="image-preview-frame">
                        <img src={image.preview_url} alt={image.file.name} className="image-preview" />
                      </div>
                      <div className="image-card-body">
                        <div className="image-card-head">
                          <strong>{image.file.name}</strong>
                          <button className="text-button" type="button" onClick={() => removeDraftImage(image.draft_id)}>
                            Remove
                          </button>
                        </div>
                        <div className="image-card-controls">
                          <label className="inline-field">
                            <span>View</span>
                            <select value={image.view} onChange={(event) => updateDraftImageView(image.draft_id, event.target.value)}>
                              {VIEW_OPTIONS.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            className={`toggle-pill ${image.is_representative ? "active" : ""}`}
                            type="button"
                            onClick={() => setRepresentativeImage(image.draft_id)}
                          >
                            {image.is_representative ? "Representative" : "Mark representative"}
                          </button>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : null}
            </section>

            <div className="doc-footer">
              <div>
                <strong>Ready to save</strong>
                <p>
                  Patient, visit, and image records will be committed through the current FastAPI endpoints with the
                  existing storage model.
                </p>
              </div>
              <button className="primary-workspace-button" type="button" onClick={() => void handleSaveCase()} disabled={saveBusy || !selectedSiteId}>
                {saveBusy ? "Saving case..." : "Save case to site"}
              </button>
            </div>
          </section>

          <aside className={`workspace-panel ${panelOpen ? "open" : ""}`}>
            <div className="workspace-panel-head">
              <div>
                <div className="doc-section-label">Slide-over</div>
                <h4>{selectedCase ? "Saved case preview" : "Draft insight"}</h4>
              </div>
              <button className="ghost-button" type="button" onClick={() => setPanelOpen((current) => !current)}>
                {panelOpen ? "Hide" : "Show"}
              </button>
            </div>

            {selectedCase ? (
              <div className="panel-stack">
                <section className="panel-card">
                  <div className="panel-card-head">
                    <strong>{formatCaseTitle(selectedCase)}</strong>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => void handleRunValidation()}
                      disabled={validationBusy || !canRunValidation}
                    >
                      {validationBusy ? "Validating..." : "Run AI validation"}
                    </button>
                  </div>
                  <div className="panel-meta">
                    <span>{selectedCase.patient_id}</span>
                    <span>{selectedCase.visit_date}</span>
                    <span>{selectedCase.culture_category}</span>
                  </div>
                  <p>
                    {selectedCase.culture_species} with {selectedCase.image_count} uploaded images. Current status is{" "}
                    {selectedCase.visit_status}.
                  </p>
                  {!canRunValidation ? <p>Viewer accounts can inspect saved images, but validation remains disabled.</p> : null}
                </section>

                {selectedCompletion ? (
                  <section className="panel-card completion-card">
                    <div className="panel-card-head">
                      <strong>{selectedCompletion.kind === "contributed" ? "Contribution recorded" : "Case saved"}</strong>
                      <span>{formatDateTime(selectedCompletion.timestamp)}</span>
                    </div>
                    <p>
                      {selectedCompletion.kind === "contributed"
                        ? `This case produced update ${selectedCompletion.update_id ?? "pending"} and is queued as a local weight delta.`
                        : "The patient, visit, and image set are now stored in the selected site workspace."}
                    </p>
                    {selectedCompletion.kind === "contributed" && selectedCompletion.stats ? (
                      <div className="panel-metric-grid">
                        <div>
                          <strong>{selectedCompletion.stats.user_contributions}</strong>
                          <span>my contributions</span>
                        </div>
                        <div>
                          <strong>{selectedCompletion.stats.total_contributions}</strong>
                          <span>global contributions</span>
                        </div>
                        <div>
                          <strong>{selectedCompletion.stats.user_contribution_pct}%</strong>
                          <span>my share</span>
                        </div>
                        <div>
                          <strong>{summary?.n_validation_runs ?? 0}</strong>
                          <span>site validations</span>
                        </div>
                      </div>
                    ) : null}
                  </section>
                ) : null}

                <section className="panel-card">
                  <div className="panel-card-head">
                    <strong>Image strip</strong>
                    <span>{panelBusy ? "Loading..." : `${selectedCaseImages.length} loaded`}</span>
                  </div>
                  <div className="panel-image-stack">
                    {selectedCaseImages.map((image) => (
                      <div key={image.image_id} className="panel-image-card">
                        {image.preview_url ? (
                          <img src={image.preview_url} alt={image.image_id} className="panel-image-preview" />
                        ) : (
                          <div className="panel-image-fallback">Preview unavailable</div>
                        )}
                        <div className="panel-image-copy">
                          <strong>{image.view}</strong>
                          <span>{image.is_representative ? "Representative" : "Supporting image"}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="panel-card">
                  <div className="panel-card-head">
                    <strong>ROI preview</strong>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => void handleRunRoiPreview()}
                      disabled={roiPreviewBusy || !canRunRoiPreview}
                    >
                      {roiPreviewBusy ? "Preparing..." : "Preview ROI"}
                    </button>
                  </div>
                  {!canRunRoiPreview ? <p>Viewer accounts can inspect images, but ROI preview remains disabled.</p> : null}
                  {canRunRoiPreview && roiPreviewItems.length === 0 ? (
                    <p>Generate a preview to compare the saved source images with their ROI crops.</p>
                  ) : null}
                  {roiPreviewItems.length > 0 ? (
                    <div className="panel-image-stack">
                      {roiPreviewItems.map((item) => (
                        <div key={`${item.image_id ?? item.source_image_path}:roi`} className="panel-image-card">
                          <div className="panel-card-head">
                            <strong>{item.view}</strong>
                            <span>{item.is_representative ? "Representative" : "Supporting image"}</span>
                          </div>
                          <div className="panel-preview-grid">
                            <div>
                              {item.source_preview_url ? (
                                <img src={item.source_preview_url} alt={`${item.view} source`} className="panel-image-preview" />
                              ) : (
                                <div className="panel-image-fallback">Source preview unavailable</div>
                              )}
                              <div className="panel-image-copy">
                                <strong>Source</strong>
                              </div>
                            </div>
                            <div>
                              {item.roi_crop_url ? (
                                <img src={item.roi_crop_url} alt={`${item.view} ROI`} className="panel-image-preview" />
                              ) : (
                                <div className="panel-image-fallback">ROI crop unavailable</div>
                              )}
                              <div className="panel-image-copy">
                                <strong>ROI crop</strong>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </section>

                <section className="panel-card">
                  <div className="panel-card-head">
                    <strong>Validation insight</strong>
                    <span>{validationResult ? validationResult.summary.validation_id : "Not run yet"}</span>
                  </div>
                  {validationResult ? (
                    <div className="panel-stack">
                      <div className="validation-summary-card">
                        <div className="validation-badge-row">
                          <span
                            className={`validation-badge ${
                              validationResult.summary.is_correct ? "tone-match" : "tone-mismatch"
                            }`}
                          >
                            {validationResult.summary.is_correct ? "Match" : "Mismatch"}
                          </span>
                          <span className={`validation-badge tone-${validationConfidenceTone}`}>
                            {validationConfidence}% confidence
                          </span>
                          <span className="validation-badge tone-neutral">{validationResult.execution_device}</span>
                        </div>
                        <div className="validation-pair-grid">
                          <div>
                            <span>Predicted</span>
                            <strong>{validationResult.summary.predicted_label}</strong>
                          </div>
                          <div>
                            <span>Culture label</span>
                            <strong>{validationResult.summary.true_label}</strong>
                          </div>
                        </div>
                        <div className="validation-gauge-meta">
                          <span>Model confidence</span>
                          <strong>{formatProbability(validationResult.summary.prediction_probability)}</strong>
                        </div>
                        <div className="validation-gauge" aria-hidden="true">
                          <div
                            className={`validation-gauge-fill tone-${validationConfidenceTone}`}
                            style={{ width: `${validationConfidence}%` }}
                          />
                        </div>
                      </div>
                      <div className="panel-metric-grid">
                        <div>
                          <strong>{validationResult.summary.predicted_label}</strong>
                          <span>predicted</span>
                        </div>
                        <div>
                          <strong>{validationResult.summary.true_label}</strong>
                          <span>culture label</span>
                        </div>
                        <div>
                          <strong>{formatProbability(validationResult.summary.prediction_probability)}</strong>
                          <span>confidence</span>
                        </div>
                        <div>
                          <strong>{validationResult.execution_device}</strong>
                          <span>device</span>
                        </div>
                      </div>
                      <p>
                        Model {validationResult.model_version.version_name} ({validationResult.model_version.architecture})
                        {" · "}
                        {validationResult.summary.is_correct ? "prediction matched culture" : "prediction diverged from culture"}
                      </p>
                      <div className="panel-image-stack">
                        {validationArtifacts.roi_crop ? (
                          <div className="panel-image-card">
                            <img src={validationArtifacts.roi_crop} alt="ROI crop" className="panel-image-preview" />
                            <div className="panel-image-copy">
                              <strong>ROI crop</strong>
                              <span>MedSAM-ready crop</span>
                            </div>
                          </div>
                        ) : null}
                        {validationArtifacts.gradcam ? (
                          <div className="panel-image-card">
                            <img src={validationArtifacts.gradcam} alt="Grad-CAM" className="panel-image-preview" />
                            <div className="panel-image-copy">
                              <strong>Grad-CAM</strong>
                              <span>Model evidence overlay</span>
                            </div>
                          </div>
                        ) : null}
                        {validationArtifacts.medsam_mask ? (
                          <div className="panel-image-card">
                            <img src={validationArtifacts.medsam_mask} alt="MedSAM mask" className="panel-image-preview" />
                            <div className="panel-image-copy">
                              <strong>MedSAM mask</strong>
                              <span>Segmentation proxy</span>
                            </div>
                          </div>
                        ) : null}
                        {!validationArtifacts.roi_crop && !validationArtifacts.gradcam && !validationArtifacts.medsam_mask ? (
                          <div className="panel-image-fallback">No validation artifacts were produced for this run.</div>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <p>Run validation from this panel to generate ROI, Grad-CAM, and a saved case-level prediction.</p>
                  )}
                </section>

                <section className="panel-card">
                  <div className="panel-card-head">
                    <strong>Contribution</strong>
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => void handleContributeCase()}
                      disabled={contributionBusy || !canContributeSelectedCase}
                    >
                      {contributionBusy ? "Contributing..." : "Contribute case update"}
                    </button>
                  </div>
                  {selectedCase.visit_status !== "active" ? (
                    <p>Only active visits are enabled for contribution under the current training policy.</p>
                  ) : null}
                  {selectedCase.visit_status === "active" && !validationResult ? (
                    <p>Validation is optional, but running it first keeps the review and contribution flow aligned.</p>
                  ) : null}
                  {!canRunValidation ? (
                    <p>Viewer accounts cannot run validation or local contribution jobs.</p>
                  ) : null}
                  {contributionResult ? (
                    <div className="panel-stack">
                      <div className="panel-metric-grid">
                        <div>
                          <strong>{contributionResult.stats.user_contributions}</strong>
                          <span>my contributions</span>
                        </div>
                        <div>
                          <strong>{contributionResult.stats.total_contributions}</strong>
                          <span>global contributions</span>
                        </div>
                        <div>
                          <strong>{contributionResult.stats.user_contribution_pct}%</strong>
                          <span>my share</span>
                        </div>
                        <div>
                          <strong>{contributionResult.execution_device}</strong>
                          <span>device</span>
                        </div>
                      </div>
                      <p>
                        Update {contributionResult.update.update_id} is queued as a{" "}
                        {contributionResult.update.upload_type} against {contributionResult.model_version.version_name}.
                      </p>
                    </div>
                  ) : (
                    <p>Contribution trains locally and stores only the weight delta for later upload.</p>
                  )}
                </section>

                <section className="panel-card">
                  <div className="panel-card-head">
                    <strong>Case history</strong>
                    <span>{historyBusy ? "Refreshing..." : `${caseHistory?.validations.length ?? 0} validations / ${caseHistory?.contributions.length ?? 0} contributions`}</span>
                  </div>
                  <div className="panel-stack">
                    <div>
                      <div className="doc-section-label">Validations</div>
                      <div className="panel-history-list">
                        {caseHistory?.validations.length ? (
                          caseHistory.validations.map((item) => (
                            <div key={item.validation_id} className="panel-history-item">
                              <strong>{item.model_version}</strong>
                              <div className="panel-meta">
                                <span>{item.run_scope}</span>
                                <span>{item.run_date}</span>
                              </div>
                              <div className="panel-meta">
                                <span>{item.predicted_label}</span>
                                <span>{formatProbability(item.prediction_probability)}</span>
                                <span>{item.is_correct ? "match" : "mismatch"}</span>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="empty-surface">No validation history for this case yet.</div>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="doc-section-label">Contributions</div>
                      <div className="panel-history-list">
                        {caseHistory?.contributions.length ? (
                          caseHistory.contributions.map((item) => (
                            <div key={item.contribution_id} className="panel-history-item">
                              <strong>{item.update_id}</strong>
                              <div className="panel-meta">
                                <span>{item.upload_type ?? "weight delta"}</span>
                                <span>{item.execution_device ?? "unknown device"}</span>
                              </div>
                              <div className="panel-meta">
                                <span>{item.update_status ?? "unknown status"}</span>
                                <span>{item.created_at}</span>
                              </div>
                            </div>
                          ))
                        ) : (
                          <div className="empty-surface">No contribution history for this case yet.</div>
                        )}
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            ) : (
              <div className="panel-stack">
                <section className="panel-card">
                  <strong>Draft checklist</strong>
                  <div className="panel-checklist">
                    <div className={draft.patient_id.trim() ? "complete" : ""}>Patient identity</div>
                    <div className={draft.visit_date.trim() ? "complete" : ""}>Visit date</div>
                    <div className={draft.culture_species.trim() ? "complete" : ""}>Organism metadata</div>
                    <div className={draftImages.length > 0 ? "complete" : ""}>Image blocks</div>
                  </div>
                </section>

                <section className="panel-card">
                  <div className="panel-card-head">
                    <strong>Selected site</strong>
                    <span>{selectedSiteId ?? "none"}</span>
                  </div>
                  <div className="panel-metric-grid">
                    <div>
                      <strong>{summary?.n_patients ?? 0}</strong>
                      <span>patients</span>
                    </div>
                    <div>
                      <strong>{summary?.n_visits ?? 0}</strong>
                      <span>visits</span>
                    </div>
                    <div>
                      <strong>{summary?.n_images ?? 0}</strong>
                      <span>images</span>
                    </div>
                    <div>
                      <strong>{summary?.n_validation_runs ?? 0}</strong>
                      <span>validations</span>
                    </div>
                  </div>
                </section>
              </div>
            )}
          </aside>
        </div>
      </section>

      {toast ? (
        <div className={`workspace-toast tone-${toast.tone}`}>
          <strong>{toast.tone === "success" ? "Saved" : "Action needed"}</strong>
          <span>{toast.message}</span>
        </div>
      ) : null}
    </main>
  );
}
