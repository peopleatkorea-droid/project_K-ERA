"use client";

import { controlPlaneBasePath } from "./control-plane/config";
import type {
  ControlPlaneBootstrap,
  ControlPlaneModelUpdate,
  ControlPlaneModelVersion,
  ControlPlaneNode,
  ControlPlaneOverview,
  ControlPlaneSession,
  ControlPlaneUser,
} from "./control-plane/types";

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = "Request failed.";
    try {
      const payload = (await response.json()) as { detail?: string };
      detail = payload.detail || detail;
    } catch {
      detail = (await response.text()) || detail;
    }
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

function cpUrl(path: string): string {
  const base = controlPlaneBasePath();
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}`;
}

export async function controlPlaneFetchMe(): Promise<ControlPlaneUser> {
  return parseResponse<ControlPlaneUser>(
    await fetch(cpUrl("/auth/me"), {
      method: "GET",
      cache: "no-store",
    }),
  );
}

export async function controlPlaneDevLogin(email: string, fullName: string): Promise<ControlPlaneSession> {
  return parseResponse<ControlPlaneSession>(
    await fetch(cpUrl("/auth/dev-login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, full_name: fullName, make_admin: true }),
    }),
  );
}

export async function controlPlaneGoogleLogin(idToken: string): Promise<ControlPlaneSession> {
  return parseResponse<ControlPlaneSession>(
    await fetch(cpUrl("/auth/google"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id_token: idToken }),
    }),
  );
}

export async function controlPlaneLogout(): Promise<void> {
  await parseResponse<{ ok: boolean }>(
    await fetch(cpUrl("/auth/logout"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }),
  );
}

export async function controlPlaneRegisterNode(payload: {
  device_name: string;
  os_info?: string;
  app_version?: string;
  site_id?: string;
  display_name?: string;
  hospital_name?: string;
  source_institution_id?: string;
}): Promise<{ node_id: string; node_token: string; bootstrap: ControlPlaneBootstrap }> {
  return parseResponse(
    await fetch(cpUrl("/nodes/register"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function controlPlaneFetchOverview(): Promise<ControlPlaneOverview> {
  return parseResponse<ControlPlaneOverview>(
    await fetch(cpUrl("/admin/overview"), {
      method: "GET",
      cache: "no-store",
    }),
  );
}

export async function controlPlaneFetchNodes(): Promise<ControlPlaneNode[]> {
  return parseResponse<ControlPlaneNode[]>(
    await fetch(cpUrl("/admin/nodes"), {
      method: "GET",
      cache: "no-store",
    }),
  );
}

export async function controlPlaneFetchModelUpdates(): Promise<ControlPlaneModelUpdate[]> {
  return parseResponse<ControlPlaneModelUpdate[]>(
    await fetch(cpUrl("/admin/model-updates"), {
      method: "GET",
      cache: "no-store",
    }),
  );
}

export async function controlPlaneReviewModelUpdate(updateId: string, decision: "approved" | "rejected", reviewerNotes: string) {
  return parseResponse<ControlPlaneModelUpdate>(
    await fetch(cpUrl(`/admin/model-updates/${updateId}/review`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision,
        reviewer_notes: reviewerNotes,
      }),
    }),
  );
}

export async function controlPlaneFetchModelVersions(): Promise<ControlPlaneModelVersion[]> {
  return parseResponse<ControlPlaneModelVersion[]>(
    await fetch(cpUrl("/admin/model-versions"), {
      method: "GET",
      cache: "no-store",
    }),
  );
}

export async function controlPlanePublishModelVersion(payload: {
  version_id?: string;
  version_name: string;
  architecture: string;
  download_url: string;
  sha256?: string;
  size_bytes?: number;
  source_provider?: string;
}): Promise<ControlPlaneModelVersion> {
  return parseResponse<ControlPlaneModelVersion>(
    await fetch(cpUrl("/admin/model-versions"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}
