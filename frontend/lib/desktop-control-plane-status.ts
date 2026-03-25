"use client";

import { fetchDesktopNodeStatus, type DesktopNodeStatus } from "./desktop-diagnostics";
import { hasDesktopRuntime } from "./desktop-ipc";

export type DesktopControlPlaneProbeState = "ready" | "not_configured" | "unavailable" | "error";

export type DesktopControlPlaneProbe = {
  state: DesktopControlPlaneProbeState;
  configured: boolean;
  nodeSyncEnabled: boolean;
  bootstrapReady: boolean;
  baseUrl: string | null;
  nodeId: string | null;
  detail: string | null;
  checkedAt: string;
};

function normalizeOptionalString(value: unknown) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function extractErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Control-plane status could not be checked.";
}

export function deriveDesktopControlPlaneProbe(
  nodeStatus: DesktopNodeStatus | null | undefined,
  detail?: string | null,
): DesktopControlPlaneProbe {
  const configured = Boolean(nodeStatus?.control_plane?.configured);
  const nodeSyncEnabled = Boolean(nodeStatus?.control_plane?.node_sync_enabled);
  const bootstrapReady = Boolean(nodeStatus?.bootstrap && typeof nodeStatus.bootstrap === "object");
  const baseUrl = normalizeOptionalString(nodeStatus?.control_plane?.base_url);
  const nodeId = normalizeOptionalString(nodeStatus?.control_plane?.node_id);

  let state: DesktopControlPlaneProbeState;
  let resolvedDetail = normalizeOptionalString(detail);

  if (!configured) {
    state = "not_configured";
    resolvedDetail ??= "Control plane is not configured for this desktop node.";
  } else if (!nodeSyncEnabled) {
    state = "not_configured";
    resolvedDetail ??= "Control-plane node sync is disabled.";
  } else if (!bootstrapReady) {
    state = "unavailable";
    resolvedDetail ??= "Control-plane bootstrap is unavailable.";
  } else {
    state = "ready";
    resolvedDetail ??= "Control-plane bootstrap is available.";
  }

  return {
    state,
    configured,
    nodeSyncEnabled,
    bootstrapReady,
    baseUrl,
    nodeId,
    detail: resolvedDetail,
    checkedAt: new Date().toISOString(),
  };
}

export async function probeDesktopControlPlaneStatus(signal?: AbortSignal) {
  if (!hasDesktopRuntime()) {
    return null;
  }
  try {
    const nodeStatus = await fetchDesktopNodeStatus({ signal, forceRefresh: true });
    return deriveDesktopControlPlaneProbe(nodeStatus);
  } catch (error) {
    return {
      state: "error",
      configured: false,
      nodeSyncEnabled: false,
      bootstrapReady: false,
      baseUrl: null,
      nodeId: null,
      detail: extractErrorMessage(error),
      checkedAt: new Date().toISOString(),
    } satisfies DesktopControlPlaneProbe;
  }
}
