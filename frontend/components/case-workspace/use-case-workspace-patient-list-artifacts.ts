"use client";

import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import {
  backfillMedsamArtifacts,
  fetchMedsamArtifactItems,
  fetchMedsamArtifactStatus,
  fetchPatientListPage,
  prewarmPatientListPage,
  type MedsamArtifactItemsResponse,
  type MedsamArtifactStatusKey,
  type MedsamArtifactStatusSummary,
} from "../../lib/api";
import { prefetchDesktopVisitImages } from "../../lib/desktop-transport";
import {
  buildPatientListThumbMap,
  samePatientListRows,
} from "./case-workspace-records";
import type { PatientListRow, PatientListThumbnail } from "./shared";

const PATIENT_LIST_PAGE_SIZE = 25;

type Locale = "en" | "ko";

type ToastState = {
  tone: "success" | "error";
  message: string;
} | null;

type Args = {
  selectedSiteId: string | null;
  token: string;
  railView: "cases" | "patients";
  showOnlyMine: boolean;
  normalizedPatientListSearch: string;
  desktopFastMode: boolean;
  workspaceTimingLogs: boolean;
  workspaceOpenedAtRef: MutableRefObject<number | null>;
  describeError: (error: unknown, fallback: string) => string;
  pick: (locale: Locale, en: string, ko: string) => string;
  locale: Locale;
  setToast: Dispatch<SetStateAction<ToastState>>;
};

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function useCaseWorkspacePatientListArtifacts({
  selectedSiteId,
  token,
  railView,
  showOnlyMine,
  normalizedPatientListSearch,
  desktopFastMode,
  workspaceTimingLogs,
  workspaceOpenedAtRef,
  describeError,
  pick,
  locale,
  setToast,
}: Args) {
  const [patientListPage, setPatientListPage] = useState(1);
  const [patientListRows, setPatientListRows] = useState<PatientListRow[]>([]);
  const [patientListTotalCount, setPatientListTotalCount] = useState(0);
  const [patientListTotalPages, setPatientListTotalPages] = useState(1);
  const [patientListLoading, setPatientListLoading] = useState(false);

  const [medsamArtifactPanelEnabled, setMedsamArtifactPanelEnabled] =
    useState(false);
  const [medsamArtifactStatus, setMedsamArtifactStatus] =
    useState<MedsamArtifactStatusSummary | null>(null);
  const [medsamArtifactStatusBusy, setMedsamArtifactStatusBusy] =
    useState(false);
  const [medsamArtifactBackfillBusy, setMedsamArtifactBackfillBusy] =
    useState(false);
  const [medsamArtifactActiveStatus, setMedsamArtifactActiveStatus] =
    useState<MedsamArtifactStatusKey | null>(null);
  const [medsamArtifactScope, setMedsamArtifactScope] = useState<
    "patient" | "visit" | "image"
  >("visit");
  const [medsamArtifactItems, setMedsamArtifactItems] = useState<
    MedsamArtifactItemsResponse["items"]
  >([]);
  const [medsamArtifactItemsBusy, setMedsamArtifactItemsBusy] = useState(
    false,
  );
  const [medsamArtifactPage, setMedsamArtifactPage] = useState(1);
  const [medsamArtifactTotalCount, setMedsamArtifactTotalCount] = useState(0);
  const [medsamArtifactTotalPages, setMedsamArtifactTotalPages] = useState(1);

  const patientListLoggedSiteIdRef = useRef<string | null>(null);

  const patientListThumbs = useMemo<Record<string, PatientListThumbnail[]>>(
    () => buildPatientListThumbMap(patientListRows),
    [patientListRows],
  );

  const resetMedsamArtifactBacklogState = useCallback(() => {
    setMedsamArtifactStatus(null);
    setMedsamArtifactStatusBusy(false);
    setMedsamArtifactActiveStatus(null);
    setMedsamArtifactItems([]);
    setMedsamArtifactItemsBusy(false);
    setMedsamArtifactPage(1);
    setMedsamArtifactTotalCount(0);
    setMedsamArtifactTotalPages(1);
  }, []);

  const handleRefreshMedsamArtifactStatus = useCallback(
    async (refresh = true) => {
      if (!selectedSiteId) {
        return;
      }
      setMedsamArtifactStatusBusy(true);
      try {
        const nextStatus = await fetchMedsamArtifactStatus(selectedSiteId, token, {
          mine: showOnlyMine,
          refresh,
        });
        setMedsamArtifactStatus(nextStatus);
      } catch (nextError) {
        setToast({
          tone: "error",
          message: describeError(
            nextError,
            pick(
              locale,
              "Unable to load artifact backlog.",
              "아티팩트 백로그를 불러오지 못했습니다.",
            ),
          ),
        });
      } finally {
        setMedsamArtifactStatusBusy(false);
      }
    },
    [describeError, locale, pick, selectedSiteId, setToast, showOnlyMine, token],
  );

  const onArtifactsChanged = useCallback(() => {
    if (
      !medsamArtifactPanelEnabled ||
      !medsamArtifactStatus ||
      !selectedSiteId
    ) {
      return;
    }
    void fetchMedsamArtifactStatus(selectedSiteId, token, {
      mine: showOnlyMine,
    })
      .then((nextStatus) => setMedsamArtifactStatus(nextStatus))
      .catch(() => {
        return;
      });
  }, [
    medsamArtifactPanelEnabled,
    medsamArtifactStatus,
    selectedSiteId,
    showOnlyMine,
    token,
  ]);

  const handleEnableMedsamArtifactPanel = useCallback(async () => {
    resetMedsamArtifactBacklogState();
    setMedsamArtifactPanelEnabled(true);
    await handleRefreshMedsamArtifactStatus(true);
  }, [handleRefreshMedsamArtifactStatus, resetMedsamArtifactBacklogState]);

  const handleDisableMedsamArtifactPanel = useCallback(() => {
    setMedsamArtifactPanelEnabled(false);
    setMedsamArtifactBackfillBusy(false);
    resetMedsamArtifactBacklogState();
  }, [resetMedsamArtifactBacklogState]);

  const handleOpenMedsamArtifactBacklog = useCallback(
    (status: MedsamArtifactStatusKey) => {
      if (!medsamArtifactPanelEnabled) {
        return;
      }
      if (medsamArtifactActiveStatus === status) {
        setMedsamArtifactActiveStatus(null);
        setMedsamArtifactItems([]);
        setMedsamArtifactPage(1);
        setMedsamArtifactTotalCount(0);
        setMedsamArtifactTotalPages(1);
        return;
      }
      setMedsamArtifactActiveStatus(status);
      setMedsamArtifactPage(1);
    },
    [medsamArtifactActiveStatus, medsamArtifactPanelEnabled],
  );

  const handleCloseMedsamArtifactBacklog = useCallback(() => {
    setMedsamArtifactActiveStatus(null);
    setMedsamArtifactItems([]);
    setMedsamArtifactPage(1);
    setMedsamArtifactTotalCount(0);
    setMedsamArtifactTotalPages(1);
  }, []);

  const handleMedsamArtifactScopeChange = useCallback(
    (scope: "patient" | "visit" | "image") => {
      setMedsamArtifactScope(scope);
      setMedsamArtifactPage(1);
    },
    [],
  );

  const handleMedsamArtifactPageChange = useCallback((nextPage: number) => {
    setMedsamArtifactPage(nextPage);
  }, []);

  const handleBackfillMedsamArtifacts = useCallback(async () => {
    if (!selectedSiteId) {
      return;
    }
    setMedsamArtifactBackfillBusy(true);
    try {
      await backfillMedsamArtifacts(selectedSiteId, token, {
        mine: showOnlyMine,
        refresh_cache: true,
      });
      await handleRefreshMedsamArtifactStatus(true);
      setToast({
        tone: "success",
        message: pick(
          locale,
          "MedSAM artifact backfill started in the background.",
          "MedSAM 아티팩트 백필이 백그라운드에서 시작되었습니다.",
        ),
      });
    } catch (nextError) {
      setToast({
        tone: "error",
        message: describeError(
          nextError,
          pick(
            locale,
            "Unable to start MedSAM artifact backfill.",
            "MedSAM 아티팩트 백필을 시작하지 못했습니다.",
          ),
        ),
      });
    } finally {
      setMedsamArtifactBackfillBusy(false);
    }
  }, [
    describeError,
    handleRefreshMedsamArtifactStatus,
    locale,
    pick,
    selectedSiteId,
    setToast,
    showOnlyMine,
    token,
  ]);

  useEffect(() => {
    setPatientListPage(1);
  }, [selectedSiteId]);

  useEffect(() => {
    patientListLoggedSiteIdRef.current = null;
    if (selectedSiteId) {
      return;
    }
    startTransition(() => {
      setPatientListRows([]);
      setPatientListTotalCount(0);
      setPatientListTotalPages(1);
    });
    setPatientListLoading(false);
  }, [selectedSiteId]);

  useEffect(() => {
    setMedsamArtifactStatus(null);
    setMedsamArtifactStatusBusy(false);
    setMedsamArtifactBackfillBusy(false);
    setMedsamArtifactActiveStatus(null);
    setMedsamArtifactItems([]);
    setMedsamArtifactItemsBusy(false);
    setMedsamArtifactPage(1);
    setMedsamArtifactTotalCount(0);
    setMedsamArtifactTotalPages(1);
  }, [selectedSiteId, showOnlyMine]);

  useEffect(() => {
    if (!selectedSiteId) {
      return;
    }
    if (railView !== "patients") {
      setPatientListLoading(false);
      return;
    }

    const currentSiteId = selectedSiteId;
    let cancelled = false;
    let prefetchTimerId: number | null = null;
    const controller = new AbortController();

    async function loadPatientListPage() {
      setPatientListLoading(true);
      try {
        const response = await fetchPatientListPage(currentSiteId, token, {
          mine: showOnlyMine,
          page: patientListPage,
          page_size: PATIENT_LIST_PAGE_SIZE,
          search: normalizedPatientListSearch,
          signal: controller.signal,
        });
        if (cancelled) {
          return;
        }
        startTransition(() => {
          setPatientListRows((current) =>
            samePatientListRows(current, response.items)
              ? current
              : response.items,
          );
          setPatientListTotalCount((current) =>
            current === response.total_count ? current : response.total_count,
          );
          setPatientListTotalPages((current) => {
            const nextTotalPages = Math.max(1, response.total_pages || 1);
            return current === nextTotalPages ? current : nextTotalPages;
          });
          setPatientListPage((current) =>
            current === response.page ? current : response.page,
          );
        });
        if (
          desktopFastMode &&
          workspaceTimingLogs &&
          patientListLoggedSiteIdRef.current !== currentSiteId
        ) {
          patientListLoggedSiteIdRef.current = currentSiteId;
          const startedAt = workspaceOpenedAtRef.current ?? performance.now();
          console.info("[kera-fast-path] patient-list-ready", {
            site_id: currentSiteId,
            rows: response.items.length,
            total_count: response.total_count,
            elapsed_ms: Math.round(performance.now() - startedAt),
          });
        }
        if (typeof window !== "undefined") {
          prefetchTimerId = window.setTimeout(() => {
            response.items.slice(0, 6).forEach((row) => {
              prefetchDesktopVisitImages(
                currentSiteId,
                row.latest_case.patient_id,
                row.latest_case.visit_date,
              );
            });
          }, 0);
        }
      } catch (nextError) {
        if (isAbortError(nextError)) {
          return;
        }
        if (!cancelled) {
          startTransition(() => {
            setPatientListRows([]);
            setPatientListTotalCount(0);
            setPatientListTotalPages(1);
          });
          setToast({
            tone: "error",
            message: describeError(
              nextError,
              pick(
                locale,
                "Unable to load the patient list.",
                "환자 목록을 불러오지 못했습니다.",
              ),
            ),
          });
        }
      } finally {
        if (!cancelled) {
          setPatientListLoading(false);
        }
      }
    }

    void loadPatientListPage();
    return () => {
      cancelled = true;
      if (prefetchTimerId !== null) {
        window.clearTimeout(prefetchTimerId);
      }
      controller.abort();
    };
  }, [
    desktopFastMode,
    describeError,
    locale,
    normalizedPatientListSearch,
    patientListPage,
    pick,
    railView,
    selectedSiteId,
    setToast,
    showOnlyMine,
    token,
    workspaceOpenedAtRef,
    workspaceTimingLogs,
  ]);

  useEffect(() => {
    if (
      !selectedSiteId ||
      railView !== "patients" ||
      !medsamArtifactPanelEnabled ||
      !medsamArtifactActiveStatus
    ) {
      setMedsamArtifactItems([]);
      setMedsamArtifactTotalCount(0);
      setMedsamArtifactTotalPages(1);
      setMedsamArtifactItemsBusy(false);
      return;
    }
    let cancelled = false;
    const controller = new AbortController();
    setMedsamArtifactItemsBusy(true);
    const activeJob = medsamArtifactStatus?.active_job as {
      status?: string;
    } | null;
    const refreshArtifacts = ["queued", "running"].includes(
      String(activeJob?.status || "").toLowerCase(),
    );
    void fetchMedsamArtifactItems(selectedSiteId, token, {
      scope: medsamArtifactScope,
      status_key: medsamArtifactActiveStatus,
      mine: showOnlyMine,
      refresh: refreshArtifacts,
      page: medsamArtifactPage,
      page_size: PATIENT_LIST_PAGE_SIZE,
      signal: controller.signal,
    })
      .then((response) => {
        if (cancelled) {
          return;
        }
        setMedsamArtifactItems(response.items);
        setMedsamArtifactTotalCount(Math.max(0, response.total_count || 0));
        setMedsamArtifactTotalPages(Math.max(1, response.total_pages || 1));
        setMedsamArtifactPage((current) =>
          current === response.page ? current : response.page,
        );
      })
      .catch((nextError) => {
        if (isAbortError(nextError)) {
          return;
        }
        if (!cancelled) {
          setMedsamArtifactItems([]);
          setMedsamArtifactTotalCount(0);
          setMedsamArtifactTotalPages(1);
          setToast({
            tone: "error",
            message: describeError(
              nextError,
              pick(
                locale,
                "Unable to load artifact backlog items.",
                "아티팩트 백로그 항목을 불러오지 못했습니다.",
              ),
            ),
          });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setMedsamArtifactItemsBusy(false);
        }
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    describeError,
    locale,
    medsamArtifactActiveStatus,
    medsamArtifactPage,
    medsamArtifactPanelEnabled,
    medsamArtifactScope,
    medsamArtifactStatus?.last_synced_at,
    pick,
    railView,
    selectedSiteId,
    setToast,
    showOnlyMine,
    token,
  ]);

  useEffect(() => {
    if (
      !medsamArtifactPanelEnabled ||
      !selectedSiteId ||
      railView !== "patients"
    ) {
      return;
    }
    const activeJob = medsamArtifactStatus?.active_job as {
      status?: string;
    } | null;
    if (
      !activeJob ||
      !["queued", "running"].includes(
        String(activeJob.status || "").toLowerCase(),
      )
    ) {
      return;
    }
    const intervalId = window.setInterval(() => {
      void fetchMedsamArtifactStatus(selectedSiteId, token, {
        mine: showOnlyMine,
        refresh: true,
      })
        .then((nextStatus) => {
          setMedsamArtifactStatus(nextStatus);
        })
        .catch(() => {
          return;
        });
    }, 4000);
    return () => window.clearInterval(intervalId);
  }, [
    medsamArtifactPanelEnabled,
    medsamArtifactStatus,
    railView,
    selectedSiteId,
    showOnlyMine,
    token,
  ]);

  const safePage = Math.min(
    Math.max(1, patientListPage),
    patientListTotalPages,
  );

  useEffect(() => {
    if (desktopFastMode) {
      return;
    }
    if (!selectedSiteId || railView === "patients") {
      return;
    }
    prewarmPatientListPage(selectedSiteId, token, {
      mine: showOnlyMine,
      page: 1,
      page_size: PATIENT_LIST_PAGE_SIZE,
      search: normalizedPatientListSearch,
    });
  }, [
    desktopFastMode,
    normalizedPatientListSearch,
    railView,
    selectedSiteId,
    showOnlyMine,
    token,
  ]);

  useEffect(() => {
    if (desktopFastMode) {
      return;
    }
    if (
      !selectedSiteId ||
      railView !== "patients" ||
      patientListRows.length === 0
    ) {
      return;
    }
    if (patientListPage >= patientListTotalPages) {
      return;
    }
    prewarmPatientListPage(selectedSiteId, token, {
      mine: showOnlyMine,
      page: patientListPage + 1,
      page_size: PATIENT_LIST_PAGE_SIZE,
      search: normalizedPatientListSearch,
    });
  }, [
    desktopFastMode,
    normalizedPatientListSearch,
    patientListPage,
    patientListRows,
    patientListTotalPages,
    railView,
    selectedSiteId,
    showOnlyMine,
    token,
  ]);

  return {
    patientListPage,
    setPatientListPage,
    patientListRows,
    setPatientListRows,
    patientListTotalCount,
    setPatientListTotalCount,
    patientListTotalPages,
    setPatientListTotalPages,
    patientListLoading,
    patientListThumbs,
    safePage,
    medsamArtifactPanelEnabled,
    medsamArtifactStatus,
    medsamArtifactStatusBusy,
    medsamArtifactBackfillBusy,
    medsamArtifactActiveStatus,
    medsamArtifactScope,
    medsamArtifactItems,
    medsamArtifactItemsBusy,
    medsamArtifactPage,
    medsamArtifactTotalCount,
    medsamArtifactTotalPages,
    onArtifactsChanged,
    handleEnableMedsamArtifactPanel,
    handleDisableMedsamArtifactPanel,
    handleRefreshMedsamArtifactStatus,
    handleOpenMedsamArtifactBacklog,
    handleCloseMedsamArtifactBacklog,
    handleMedsamArtifactScopeChange,
    handleMedsamArtifactPageChange,
    handleBackfillMedsamArtifacts,
  };
}
