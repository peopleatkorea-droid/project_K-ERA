import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useCaseWorkspaceSiteOverview } from "./use-case-workspace-site-overview";

const apiMocks = vi.hoisted(() => ({
  fetchSiteActivity: vi.fn(),
  fetchSiteModelVersions: vi.fn(),
  fetchSiteValidations: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  fetchSiteActivity: apiMocks.fetchSiteActivity,
  fetchSiteModelVersions: apiMocks.fetchSiteModelVersions,
  fetchSiteValidations: apiMocks.fetchSiteValidations,
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

describe("useCaseWorkspaceSiteOverview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.fetchSiteModelVersions.mockResolvedValue([]);
  });

  it("reuses the pending site-activity request for the same site", async () => {
    const pendingActivity = createDeferred<any>();
    apiMocks.fetchSiteActivity.mockReturnValue(pendingActivity.promise);

    const { result } = renderHook(() =>
      useCaseWorkspaceSiteOverview({
        selectedSiteId: "SITE_A",
        token: "token",
        unableLoadSiteActivity: "activity failed",
        unableLoadSiteValidationHistory: "validation failed",
        defaultModelCompareSelection: () => [],
        defaultValidationModelVersionSelection: () => null,
        describeError: (error, fallback) =>
          error instanceof Error ? error.message : fallback,
        setToast: vi.fn(),
      }),
    );

    let firstRequest!: Promise<any>;
    let secondRequest!: Promise<any>;
    await act(async () => {
      firstRequest = result.current.loadSiteActivity("SITE_A");
      secondRequest = result.current.loadSiteActivity("SITE_A");
    });

    expect(apiMocks.fetchSiteActivity).toHaveBeenCalledTimes(1);
    expect(result.current.activityBusy).toBe(true);

    await act(async () => {
      pendingActivity.resolve({
        contribution_leaderboard: [],
        recent_activity: [],
      });
      await Promise.all([firstRequest, secondRequest]);
    });

    expect(result.current.activityBusy).toBe(false);
    expect(result.current.siteActivity).toMatchObject({
      contribution_leaderboard: [],
      recent_activity: [],
    });
  });

  it("reuses the pending validation-history request for the same site", async () => {
    const pendingValidations = createDeferred<any[]>();
    apiMocks.fetchSiteValidations.mockReturnValue(pendingValidations.promise);

    const { result } = renderHook(() =>
      useCaseWorkspaceSiteOverview({
        selectedSiteId: "SITE_A",
        token: "token",
        unableLoadSiteActivity: "activity failed",
        unableLoadSiteValidationHistory: "validation failed",
        defaultModelCompareSelection: () => [],
        defaultValidationModelVersionSelection: () => null,
        describeError: (error, fallback) =>
          error instanceof Error ? error.message : fallback,
        setToast: vi.fn(),
      }),
    );

    let firstRequest!: Promise<any[]>;
    let secondRequest!: Promise<any[]>;
    await act(async () => {
      firstRequest = result.current.loadSiteValidationRuns("SITE_A");
      secondRequest = result.current.loadSiteValidationRuns("SITE_A");
    });

    expect(apiMocks.fetchSiteValidations).toHaveBeenCalledTimes(1);
    expect(result.current.siteValidationBusy).toBe(true);

    await act(async () => {
      pendingValidations.resolve([
        {
          run_id: "validation-1",
        },
      ]);
      await Promise.all([firstRequest, secondRequest]);
    });

    expect(result.current.siteValidationBusy).toBe(false);
    expect(result.current.siteValidationRuns).toHaveLength(1);
    expect(result.current.siteValidationRuns[0]).toMatchObject({
      run_id: "validation-1",
    });
  });
});
