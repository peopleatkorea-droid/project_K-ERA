import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCaseWorkspaceSiteBackgroundLoads } from "./use-case-workspace-site-background-loads";

const desktopTransportMocks = vi.hoisted(() => ({
  canUseDesktopTransport: vi.fn(() => false),
}));

const runtimePrewarmMocks = vi.hoisted(() => ({
  prewarmDesktopWorker: vi.fn(() => Promise.resolve()),
  prewarmDesktopMlBackend: vi.fn(() => Promise.resolve()),
  runAfterDesktopInteractionIdle: vi.fn((task: () => void) => {
    task();
    return () => undefined;
  }),
}));

vi.mock("../../lib/desktop-transport", () => ({
  canUseDesktopTransport: desktopTransportMocks.canUseDesktopTransport,
}));

vi.mock("../../lib/desktop-runtime-prewarm", () => ({
  prewarmDesktopWorker: runtimePrewarmMocks.prewarmDesktopWorker,
  prewarmDesktopMlBackend: runtimePrewarmMocks.prewarmDesktopMlBackend,
  runAfterDesktopInteractionIdle: runtimePrewarmMocks.runAfterDesktopInteractionIdle,
}));

function Harness(props: Parameters<typeof useCaseWorkspaceSiteBackgroundLoads>[0]) {
  useCaseWorkspaceSiteBackgroundLoads(props);
  return null;
}

const idlePrefetchCases = [
  {
    case_id: "case-1",
    patient_id: "P-001",
    visit_date: "Initial",
  },
  {
    case_id: "case-2",
    patient_id: "P-002",
    visit_date: "FU #1",
  },
] as any;

describe("useCaseWorkspaceSiteBackgroundLoads", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stages desktop worker and ML warm-up during idle patient-list time", async () => {
    desktopTransportMocks.canUseDesktopTransport.mockReturnValue(true);
    const ensureSiteModelVersionsLoaded = vi.fn(() => Promise.resolve([]));
    const ensureSiteValidationRunsLoaded = vi.fn(() => Promise.resolve([]));

    render(
      <Harness
        selectedSiteId="SITE_A"
        railView="patients"
        hasSelectedCase={false}
        canRunValidation
        idlePatientListPrefetchCases={[]}
        preloadCaseVisitImages={vi.fn(() => Promise.resolve([]))}
        ensureSiteValidationRunsLoaded={ensureSiteValidationRunsLoaded}
        ensureSiteModelVersionsLoaded={ensureSiteModelVersionsLoaded}
      />,
    );

    await vi.advanceTimersByTimeAsync(1800);
    expect(ensureSiteModelVersionsLoaded).toHaveBeenCalledWith(
      "SITE_A",
      expect.any(AbortSignal),
    );
    expect(runtimePrewarmMocks.prewarmDesktopWorker).not.toHaveBeenCalled();
    expect(runtimePrewarmMocks.prewarmDesktopMlBackend).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(3200);
    expect(runtimePrewarmMocks.prewarmDesktopWorker).toHaveBeenCalledTimes(1);
    expect(runtimePrewarmMocks.prewarmDesktopMlBackend).toHaveBeenCalledTimes(1);
    expect(
      runtimePrewarmMocks.prewarmDesktopWorker.mock.invocationCallOrder[0],
    ).toBeLessThan(
      runtimePrewarmMocks.prewarmDesktopMlBackend.mock.invocationCallOrder[0],
    );
  });

  it("skips the idle runtime warm-up once a saved case is already open", async () => {
    desktopTransportMocks.canUseDesktopTransport.mockReturnValue(true);
    const ensureSiteModelVersionsLoaded = vi.fn(() => Promise.resolve([]));

    render(
      <Harness
        selectedSiteId="SITE_A"
        railView="patients"
        hasSelectedCase
        canRunValidation
        idlePatientListPrefetchCases={idlePrefetchCases}
        preloadCaseVisitImages={vi.fn(() => Promise.resolve([]))}
        ensureSiteValidationRunsLoaded={vi.fn(() => Promise.resolve([]))}
        ensureSiteModelVersionsLoaded={ensureSiteModelVersionsLoaded}
      />,
    );

    await vi.advanceTimersByTimeAsync(6000);
    expect(ensureSiteModelVersionsLoaded).not.toHaveBeenCalled();
    expect(runtimePrewarmMocks.prewarmDesktopWorker).not.toHaveBeenCalled();
    expect(runtimePrewarmMocks.prewarmDesktopMlBackend).not.toHaveBeenCalled();
  });

  it("prefetches the first saved-case image caches during idle patient-list time", async () => {
    desktopTransportMocks.canUseDesktopTransport.mockReturnValue(true);
    const preloadCaseVisitImages = vi.fn(() => Promise.resolve([]));

    render(
      <Harness
        selectedSiteId="SITE_A"
        railView="patients"
        hasSelectedCase={false}
        canRunValidation
        idlePatientListPrefetchCases={idlePrefetchCases}
        preloadCaseVisitImages={preloadCaseVisitImages}
        ensureSiteValidationRunsLoaded={vi.fn(() => Promise.resolve([]))}
        ensureSiteModelVersionsLoaded={vi.fn(() => Promise.resolve([]))}
      />,
    );

    await vi.advanceTimersByTimeAsync(2599);
    expect(preloadCaseVisitImages).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(preloadCaseVisitImages).toHaveBeenNthCalledWith(
      1,
      "SITE_A",
      idlePrefetchCases[0],
      { signal: expect.any(AbortSignal) },
    );
    expect(preloadCaseVisitImages).toHaveBeenNthCalledWith(
      2,
      "SITE_A",
      idlePrefetchCases[1],
      { signal: expect.any(AbortSignal) },
    );
  });
});
