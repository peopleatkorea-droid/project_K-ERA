const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:8000";

export function buildApiUrl(path: string): string {
  return `${API_BASE_URL}${path}`;
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

export async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) {
    headers.set("Content-Type", headers.get("Content-Type") ?? "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(buildApiUrl(path), {
    ...init,
    headers,
  });
  if (!response.ok) {
    throw new Error(await readErrorDetail(response, "Request failed"));
  }
  return (await response.json()) as T;
}

export async function requestBlob(path: string, token: string, fallbackLabel: string): Promise<Blob> {
  const response = await fetch(buildApiUrl(path), {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(await readErrorDetail(response, fallbackLabel));
  }
  return response.blob();
}
