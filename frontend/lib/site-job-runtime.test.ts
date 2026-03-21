import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SiteJobRecord } from "./types";

const trainingMocks = vi.hoisted(() => ({
  fetchSiteJob: vi.fn(),
}));

const desktopMocks = vi.hoisted(() => ({
  hasDesktopRuntime: vi.fn(),
  invokeDesktop: vi.fn(),
  listenDesktopEvent: vi.fn(),
}));

vi.mock("./api", () => ({
  fetchSiteJob: trainingMocks.fetchSiteJob,
}));

vi.mock("./desktop-ipc", () => ({
  hasDesktopRuntime: desktopMocks.hasDesktopRuntime,
  invokeDesktop: desktopMocks.invokeDesktop,
  listenDesktopEvent: desktopMocks.listenDesktopEvent,
}));

describe("site-job-runtime", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    desktopMocks.hasDesktopRuntime.mockReturnValue(false);
  });

  function createJob(overrides: Partial<SiteJobRecord> = {}): SiteJobRecord {
    return {
      job_id: "job_1",
      job_type: "site_validation",
      status: "queued",
      payload: {},
      created_at: "2026-03-22T00:00:00Z",
      ...overrides,
    };
  }

  it("treats queued, running, and cancelling as active site job states", async () => {
    const mod = await import("./site-job-runtime");

    expect(mod.isSiteJobActiveStatus("queued")).toBe(true);
    expect(mod.isSiteJobActiveStatus("running")).toBe(true);
    expect(mod.isSiteJobActiveStatus("cancelling")).toBe(true);
    expect(mod.isSiteJobActiveStatus("done")).toBe(false);
    expect(mod.isSiteJobActiveStatus("failed")).toBe(false);
  });

  it("polls until the job reaches a terminal state", async () => {
    trainingMocks.fetchSiteJob
      .mockResolvedValueOnce(createJob({ status: "running" }))
      .mockResolvedValueOnce(createJob({ status: "done" }));
    const updates: Array<{ job_id: string; status: string }> = [];

    const mod = await import("./site-job-runtime");

    const result = await mod.waitForSiteJobSettlement({
      siteId: "39100103",
      token: "desktop-token",
      initialJob: createJob(),
      intervalMs: 0,
      onUpdate(job) {
        updates.push({ job_id: job.job_id, status: job.status });
      },
    });

    expect(trainingMocks.fetchSiteJob).toHaveBeenNthCalledWith(1, "39100103", "job_1", "desktop-token");
    expect(trainingMocks.fetchSiteJob).toHaveBeenNthCalledWith(2, "39100103", "job_1", "desktop-token");
    expect(updates).toEqual([
      { job_id: "job_1", status: "running" },
      { job_id: "job_1", status: "done" },
    ]);
    expect(result).toMatchObject({ job_id: "job_1", status: "done" });
  });

  it("uses the desktop event stream when the desktop runtime is available", async () => {
    desktopMocks.hasDesktopRuntime.mockReturnValue(true);
    let handler:
      | ((payload: {
          site_id: string;
          job_id: string;
          job: SiteJobRecord | null;
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
        job_id: "job_1",
        job: createJob({ status: "running" }),
        terminal: false,
      });
      await handler({
        site_id: "39100103",
        job_id: "job_1",
        job: createJob({ status: "done" }),
        terminal: true,
      });
    });
    const updates: string[] = [];

    const mod = await import("./site-job-runtime");

    const result = await mod.waitForSiteJobSettlement({
      siteId: "39100103",
      token: "desktop-token",
      initialJob: createJob(),
      onUpdate(job) {
        updates.push(job.status);
      },
    });

    expect(desktopMocks.listenDesktopEvent).toHaveBeenCalledWith("kera://site-job-update", expect.any(Function));
    expect(desktopMocks.invokeDesktop).toHaveBeenCalledWith("start_site_job_event_stream", {
      payload: {
        site_id: "39100103",
        token: "desktop-token",
        job_id: "job_1",
      },
    });
    expect(trainingMocks.fetchSiteJob).not.toHaveBeenCalled();
    expect(updates).toEqual(["running", "done"]);
    expect(result).toMatchObject({ status: "done" });
  });
});
