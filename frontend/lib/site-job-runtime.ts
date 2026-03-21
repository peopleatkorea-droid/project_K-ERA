"use client";

import { fetchSiteJob } from "./api";
import { hasDesktopRuntime, invokeDesktop, listenDesktopEvent } from "./desktop-ipc";
import type { SiteJobRecord } from "./types";

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

export function isSiteJobActiveStatus(status: string | null | undefined) {
  return ["queued", "running", "cancelling"].includes(String(status || "").trim().toLowerCase());
}

type SiteJobUpdateEvent = {
  site_id: string;
  job_id: string;
  job: SiteJobRecord | null;
  status?: string | null;
  terminal: boolean;
  error?: string | null;
};

type WaitForSiteJobSettlementOptions = {
  siteId: string;
  token: string;
  initialJob: SiteJobRecord;
  intervalMs?: number;
  isActive?: (status: string | null | undefined) => boolean;
  onUpdate?: (job: SiteJobRecord) => void | Promise<void>;
};

async function waitForSiteJobSettlementViaDesktopEvents({
  siteId,
  token,
  initialJob,
  isActive = isSiteJobActiveStatus,
  onUpdate,
}: WaitForSiteJobSettlementOptions) {
  return new Promise<SiteJobRecord>(async (resolve, reject) => {
    let settled = false;
    let unlisten: (() => void) | null = null;

    const cleanup = () => {
      if (settled) {
        return;
      }
      settled = true;
      unlisten?.();
    };

    try {
      unlisten = await listenDesktopEvent<SiteJobUpdateEvent>("kera://site-job-update", async (event) => {
        if (settled || event.site_id !== siteId || event.job_id !== initialJob.job_id) {
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
        if (onUpdate) {
          await onUpdate(event.job);
        }
        if (event.terminal || !isActive(event.job.status)) {
          cleanup();
          resolve(event.job);
        }
      });

      await invokeDesktop<void>("start_site_job_event_stream", {
        payload: {
          site_id: siteId,
          token,
          job_id: initialJob.job_id,
        },
      });
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

export async function waitForSiteJobSettlement({
  siteId,
  token,
  initialJob,
  intervalMs = 1000,
  isActive = isSiteJobActiveStatus,
  onUpdate,
}: WaitForSiteJobSettlementOptions) {
  if (hasDesktopRuntime()) {
    try {
      return await waitForSiteJobSettlementViaDesktopEvents({
        siteId,
        token,
        initialJob,
        intervalMs,
        isActive,
        onUpdate,
      });
    } catch (error) {
      if (typeof console !== "undefined") {
        console.warn("[K-ERA desktop] Falling back to polling for site job settlement.", error);
      }
    }
  }
  let latestJob = initialJob;
  while (isActive(latestJob.status)) {
    await sleep(intervalMs);
    latestJob = await fetchSiteJob(siteId, latestJob.job_id, token);
    if (onUpdate) {
      await onUpdate(latestJob);
    }
  }
  return latestJob;
}
