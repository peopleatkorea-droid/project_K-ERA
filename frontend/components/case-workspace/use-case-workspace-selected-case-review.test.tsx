import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useCaseWorkspaceSelectedCaseReview } from "./use-case-workspace-selected-case-review";

const apiMocks = vi.hoisted(() => ({
  fetchCaseHistory: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  fetchCaseHistory: apiMocks.fetchCaseHistory,
}));

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

describe("useCaseWorkspaceSelectedCaseReview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reuses the pending case-history request for the same patient visit", async () => {
    const pendingHistory = createDeferred<any>();
    apiMocks.fetchCaseHistory.mockReturnValue(pendingHistory.promise);

    const setCaseHistory = vi.fn();
    const setHistoryBusy = vi.fn();

    const { result } = renderHook(() =>
      useCaseWorkspaceSelectedCaseReview({
        caseImageCacheVersion: 0,
        selectedSiteId: "SITE_A",
        selectedCase: null,
        selectedPatientCases: [],
        selectedCaseImages: [],
        selectedCaseImagesOwnerCaseId: null,
        token: "token",
        locale: "ko",
        unableLoadCaseHistory: "history failed",
        describeError: (error, fallback) =>
          error instanceof Error ? error.message : fallback,
        pick: (locale, en, ko) => (locale === "ko" ? ko : en),
        setToast: vi.fn(),
        workspaceTimingLogs: false,
        setPatientVisitGallery: vi.fn(),
        setPatientVisitGalleryLoadingCaseIds: vi.fn(),
        setPatientVisitGalleryErrorCaseIds: vi.fn(),
        setPanelBusy: vi.fn(),
        setPatientVisitGalleryBusy: vi.fn(),
        setHistoryBusy,
        setCaseHistory,
        replaceSelectedCaseImages: vi.fn(),
        markPatientVisitGalleryLoading: vi.fn(),
        markPatientVisitGalleryLoadingBatch: vi.fn(),
        markPatientVisitGalleryError: vi.fn(),
        markPatientVisitGalleryErrorBatch: vi.fn(),
        ensurePatientVisitImagesLoaded: vi.fn(async () => []),
        loadPatientImageRecords: vi.fn(async () => new Map()),
        commitCaseImages: vi.fn(),
        commitPatientVisitGalleryBatch: vi.fn(),
        selectedCaseImageCaseIdRef: { current: null },
        caseImageCacheRef: { current: new Map() },
        caseHistoryCacheRef: { current: new Map() },
        caseOpenSlaSessionRef: { current: null },
      }),
    );

    let firstRequest!: Promise<void>;
    let secondRequest!: Promise<void>;
    await act(async () => {
      firstRequest = result.current.loadCaseHistory(
        "SITE_A",
        "P-001",
        "Initial",
      );
      secondRequest = result.current.loadCaseHistory(
        "SITE_A",
        "P-001",
        "Initial",
      );
    });

    expect(apiMocks.fetchCaseHistory).toHaveBeenCalledTimes(1);

    await act(async () => {
      pendingHistory.resolve({
        patient: { patient_id: "P-001" },
        visits: [],
        images: [],
      });
      await Promise.all([firstRequest, secondRequest]);
    });

    expect(setHistoryBusy).toHaveBeenCalledWith(true);
    expect(setCaseHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        patient: expect.objectContaining({ patient_id: "P-001" }),
      }),
    );
  });
});
