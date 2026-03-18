const configuredApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.trim().replace(/\/$/, "") ?? "";
const configuredLocalNodeApiBaseUrl =
  process.env.NEXT_PUBLIC_LOCAL_NODE_API_BASE_URL?.trim().replace(/\/+$/, "") ?? "";

function resolveApiBaseUrl(): string {
  if (configuredApiBaseUrl) {
    return configuredApiBaseUrl;
  }
  if (configuredLocalNodeApiBaseUrl) {
    return configuredLocalNodeApiBaseUrl;
  }
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      return `http://${host}:8000`;
    }
  }
  return "";
}

export function buildApiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const baseUrl = resolveApiBaseUrl();
  return baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath;
}

function stringifyApiDetail(detail: unknown): string {
  if (typeof detail === "string") {
    return detail;
  }
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item === "object") {
          const record = item as { loc?: unknown; msg?: unknown };
          const location = Array.isArray(record.loc) ? record.loc.map((part) => String(part)).join(".") : "";
          const message = typeof record.msg === "string" ? record.msg : JSON.stringify(item);
          return location ? `${location}: ${message}` : message;
        }
        return String(item);
      })
      .join(" | ");
  }
  if (detail && typeof detail === "object") {
    return JSON.stringify(detail);
  }
  return String(detail);
}

async function readErrorDetail(response: Response, fallbackLabel: string): Promise<string> {
  const contentType = response.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    const payload = (await response.json()) as { detail?: unknown };
    return stringifyApiDetail(payload.detail) || `${fallbackLabel}: ${response.status}`;
  }
  const detail = await response.text();
  return detail || `${fallbackLabel}: ${response.status}`;
}

async function requestFromUrl<T>(
  url: string,
  init: RequestInit = {},
  token?: string,
  unavailableMessage = "Request server is unavailable.",
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) {
    headers.set("Content-Type", headers.get("Content-Type") ?? "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers,
    });
  } catch {
    throw new Error(unavailableMessage);
  }
  if (!response.ok) {
    throw new Error(await readErrorDetail(response, "Request failed"));
  }
  return (await response.json()) as T;
}

export async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  return requestFromUrl<T>(buildApiUrl(path), init, token, "Local API server is unavailable.");
}

export async function requestSameOrigin<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  return requestFromUrl<T>(path, init, token, "Web API server is unavailable.");
}

export async function requestBlob(
  path: string,
  token: string,
  fallbackLabel: string,
  init: RequestInit = {},
): Promise<Blob> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(buildApiUrl(path), {
      ...init,
      headers,
    });
  } catch {
    throw new Error("Local API server is unavailable.");
  }
  if (!response.ok) {
    throw new Error(await readErrorDetail(response, fallbackLabel));
  }
  return response.blob();
}
