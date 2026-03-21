import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveLesionPreviewJobResponse } from "./types";

const apiMocks = vi.hoisted(() => ({
  fetchLiveLesionPreviewJob: vi.fn(),
}));

const desktopMocks = vi.hoisted(() => ({
  hasDesktopRuntime: vi.fn(),
  invokeDesktop: vi.fn(),
  listenDesktopEvent: vi.fn(),
}));

vi.mock("./api", () => ({
  fetchLiveLesionPreviewJob: apiMocks.fetchLiveLesionPreviewJob,
}));

vi.mock("./desktop-ipc", () => ({
  hasDesktopRuntime: desktopMocks.hasDesktopRuntime,
  invokeDesktop: desktopMocks.invokeDesktop,
  listenDesktopEvent: desktopMocks.listenDesktopEvent,
}));

describe("live-lesion-preview-runtime", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    desktopMocks.hasDesktopRuntime.mockReturnValue(false);
  });

  function createJob(overrides: Partial<LiveLesionPreviewJobResponse> = {}): LiveLesionPreviewJobResponse {
    return {
      job_id: "job_1",
      site_id: "39100103",
      image_id: "image_1",
      patient_id: "patient_1",
      visit_date: "2026-03-22T00:00:00Z",
      status: "running",
      ...overrides,
    };
  }

  it("polls until a live lesion preview job reaches a terminal state", async () => {
    apiMocks.fetchLiveLesionPreviewJob
      .mockResolvedValueOnce(createJob({ status: "running" }))
      .mockResolvedValueOnce(createJob({ status: "done" }));
    const runningStatuses: string[] = [];

    const mod = await import("./live-lesion-preview-runtime");

    const result = await mod.waitForLiveLesionPreviewSettlement({
      siteId: "39100103",
      imageId: "image_1",
      jobId: "job_1",
      token: "desktop-token",
      intervalMs: 0,
      onRunning(job) {
        runningStatuses.push(job.status);
      },
    });

    expect(apiMocks.fetchLiveLesionPreviewJob).toHaveBeenNthCalledWith(1, "39100103", "image_1", "job_1", "desktop-token");
    expect(apiMocks.fetchLiveLesionPreviewJob).toHaveBeenNthCalledWith(2, "39100103", "image_1", "job_1", "desktop-token");
    expect(runningStatuses).toEqual(["running"]);
    expect(result).toMatchObject({ status: "done" });
  });

  it("throws a timeout error after the max attempts are exhausted", async () => {
    apiMocks.fetchLiveLesionPreviewJob.mockResolvedValue(createJob({ status: "running" }));

    const mod = await import("./live-lesion-preview-runtime");

    await expect(
      mod.waitForLiveLesionPreviewSettlement({
        siteId: "39100103",
        imageId: "image_1",
        jobId: "job_1",
        token: "desktop-token",
        intervalMs: 0,
        maxAttempts: 2,
      }),
    ).rejects.toBeInstanceOf(mod.LiveLesionPreviewTimeoutError);
  });

  it("uses the desktop event stream when the desktop runtime is available", async () => {
    desktopMocks.hasDesktopRuntime.mockReturnValue(true);
    let handler:
      | ((payload: {
          site_id: string;
          image_id: string;
          job_id: string;
          job: LiveLesionPreviewJobResponse | null;
          terminal: boolean;
          error?: string | null;
        }) => Promise<void>)
      | null = null;
    desktopMocks.listenDesktopEvent.mockImplementation(async (_eventName, nextHandler) => {
      handler = nextHandler;
      return vi.fn();
    });
    desktopMocks.invokeDesktop.mockImplementation(async () => {
      if (!handler) {
        throw new Error("missing desktop event handler");
      }
      await handler({
        site_id: "39100103",
        image_id: "image_1",
        job_id: "job_1",
        job: createJob({ status: "running" }),
        terminal: false,
      });
      await handler({
        site_id: "39100103",
        image_id: "image_1",
        job_id: "job_1",
        job: createJob({ status: "done" }),
        terminal: true,
      });
    });
    const runningStatuses: string[] = [];

    const mod = await import("./live-lesion-preview-runtime");

    const result = await mod.waitForLiveLesionPreviewSettlement({
      siteId: "39100103",
      imageId: "image_1",
      jobId: "job_1",
      token: "desktop-token",
      onRunning(job) {
        runningStatuses.push(job.status);
      },
    });

    expect(desktopMocks.listenDesktopEvent).toHaveBeenCalledWith(
      "kera://live-lesion-preview-update",
      expect.any(Function),
    );
    expect(desktopMocks.invokeDesktop).toHaveBeenCalledWith("start_live_lesion_preview_event_stream", {
      payload: {
        site_id: "39100103",
        token: "desktop-token",
        image_id: "image_1",
        job_id: "job_1",
      },
    });
    expect(apiMocks.fetchLiveLesionPreviewJob).not.toHaveBeenCalled();
    expect(runningStatuses).toEqual(["running"]);
    expect(result).toMatchObject({ status: "done" });
  });
});
