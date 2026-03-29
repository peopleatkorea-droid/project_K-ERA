"use client";

function localNodeBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_LOCAL_NODE_API_BASE_URL?.trim().replace(/\/+$/, "");
  if (configured) {
    return configured;
  }
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      return `http://${host}:8000`;
    }
  }
  return "";
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let detail = "Local node request failed.";
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

export async function persistLocalNodeCredentials(payload: {
  control_plane_base_url: string;
  node_id: string;
  node_token: string;
  site_id?: string | null;
  overwrite?: boolean;
}): Promise<{
  saved: boolean;
  credentials: Record<string, unknown>;
  bootstrap: Record<string, unknown> | null;
}> {
  const baseUrl = localNodeBaseUrl();
  if (!baseUrl) {
    throw new Error("Local node API base URL is not configured.");
  }
  return parseResponse(
    await fetch(`${baseUrl}/api/control-plane/node/credentials`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

export async function registerLocalNodeViaMainAdmin(payload: {
  control_plane_user_token: string;
  control_plane_base_url?: string | null;
  device_name: string;
  os_info?: string;
  app_version?: string;
  site_id?: string;
  display_name?: string;
  hospital_name?: string;
  source_institution_id?: string;
  overwrite?: boolean;
}): Promise<{
  registered: boolean;
  node_id: string;
  node_token: string;
  bootstrap: Record<string, unknown> | null;
  credentials: Record<string, unknown>;
}> {
  const baseUrl = localNodeBaseUrl();
  if (!baseUrl) {
    throw new Error("Local node API base URL is not configured.");
  }
  return parseResponse(
    await fetch(`${baseUrl}/api/control-plane/node/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        registration_source: "main_admin",
      }),
    }),
  );
}
