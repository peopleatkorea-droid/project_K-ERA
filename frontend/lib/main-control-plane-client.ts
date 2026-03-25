import { controlPlaneBasePath } from "./control-plane/config";
import { requestSameOrigin } from "./api-core";

const MAIN_APP_TOKEN_KEY = "kera_web_token";
const configuredMainControlPlaneApiBaseUrl =
  process.env.NEXT_PUBLIC_KERA_CONTROL_PLANE_API_BASE_URL?.trim().replace(/\/+$/, "") ?? "";

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function resolveMainControlPlaneBase(): string {
  if (!configuredMainControlPlaneApiBaseUrl) {
    return `${controlPlaneBasePath()}/main`;
  }
  return configuredMainControlPlaneApiBaseUrl.endsWith("/main")
    ? configuredMainControlPlaneApiBaseUrl
    : `${configuredMainControlPlaneApiBaseUrl}/main`;
}

export function mainControlPlanePath(path: string): string {
  return `${resolveMainControlPlaneBase()}${normalizePath(path)}`;
}

export function persistMainAppToken(token: string | null | undefined) {
  const nextToken = String(token ?? "").trim();
  if (!nextToken || typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(MAIN_APP_TOKEN_KEY, nextToken);
}

export async function requestMainControlPlane<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  return requestSameOrigin<T>(
    mainControlPlanePath(path),
    init,
    token,
    "Control-plane server is unavailable.",
  );
}
