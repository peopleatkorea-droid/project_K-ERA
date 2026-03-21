"use client";

import { fetchLiveLesionPreviewJob, type LiveLesionPreviewJobResponse } from "./api";
import { hasDesktopRuntime, invokeDesktop, listenDesktopEvent } from "./desktop-ipc";

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

export class LiveLesionPreviewTimeoutError extends Error {
  constructor() {
    super("Live lesion preview timed out.");
    this.name = "LiveLesionPreviewTimeoutError";
  }
}

type LiveLesionPreviewUpdateEvent = {
  site_id: string;
  image_id: string;
  job_id: string;
  job: LiveLesionPreviewJobResponse | null;
  status?: string | null;
  terminal: boolean;
  error?: string | null;
};

type WaitForLiveLesionPreviewSettlementOptions = {
  siteId: string;
  imageId: string;
  jobId: string;
  token: string;
  intervalMs?: number;
  maxAttempts?: number;
  shouldContinue?: () => boolean;
  onRunning?: (job: LiveLesionPreviewJobResponse) => void | Promise<void>;
};

async function waitForLiveLesionPreviewSettlementViaDesktopEvents({
  siteId,
  imageId,
  jobId,
  token,
  intervalMs = 700,
  maxAttempts = 30,
  shouldContinue,
  onRunning,
}: WaitForLiveLesionPreviewSettlementOptions) {
  return new Promise<LiveLesionPreviewJobResponse | null>(async (resolve, reject) => {
    let settled = false;
    let unlisten: (() => void) | null = null;
    const timeoutId = window.setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      unlisten?.();
      reject(new LiveLesionPreviewTimeoutError());
    }, Math.max(1, intervalMs * maxAttempts));

    const cleanup = () => {
      if (settled) {
        return;
      }
      settled = true;
      window.clearTimeout(timeoutId);
      unlisten?.();
    };

    try {
      unlisten = await listenDesktopEvent<LiveLesionPreviewUpdateEvent>(
        "kera://live-lesion-preview-update",
        async (event) => {
          if (settled || event.site_id !== siteId || event.image_id !== imageId || event.job_id !== jobId) {
            return;
          }
          if (shouldContinue && !shouldContinue()) {
            cleanup();
            resolve(null);
            return;
          }
          if (event.error) {
            cleanup();
            reject(new Error(event.error));
            return;
          }
          if (!event.job) {
            return;
          }
          if (event.job.status === "running") {
            if (onRunning) {
              await onRunning(event.job);
            }
            return;
          }
          cleanup();
          resolve(event.job);
        },
      );

      await invokeDesktop<void>("start_live_lesion_preview_event_stream", {
        payload: {
          site_id: siteId,
          token,
          image_id: imageId,
          job_id: jobId,
        },
      });
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

export async function waitForLiveLesionPreviewSettlement({
  siteId,
  imageId,
  jobId,
  token,
  intervalMs = 700,
  maxAttempts = 30,
  shouldContinue,
  onRunning,
}: WaitForLiveLesionPreviewSettlementOptions): Promise<LiveLesionPreviewJobResponse | null> {
  if (hasDesktopRuntime()) {
    try {
      return await waitForLiveLesionPreviewSettlementViaDesktopEvents({
        siteId,
        imageId,
        jobId,
        token,
        intervalMs,
        maxAttempts,
        shouldContinue,
        onRunning,
      });
    } catch (error) {
      if (typeof console !== "undefined") {
        console.warn("[K-ERA desktop] Falling back to polling for live lesion preview settlement.", error);
      }
    }
  }
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await sleep(intervalMs);
    if (shouldContinue && !shouldContinue()) {
      return null;
    }
    const job = await fetchLiveLesionPreviewJob(siteId, imageId, jobId, token);
    if (shouldContinue && !shouldContinue()) {
      return null;
    }
    if (job.status === "running") {
      if (onRunning) {
        await onRunning(job);
      }
      continue;
    }
    return job;
  }
  throw new LiveLesionPreviewTimeoutError();
}
