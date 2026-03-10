export type LoginResponse = {
  access_token: string;
  token_type: "bearer";
  user: {
    user_id: string;
    username: string;
    full_name: string;
    role: string;
    site_ids: string[] | null;
  };
};

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:8000";

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", headers.get("Content-Type") ?? "application/json");
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function login(username: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export async function fetchMe(token: string) {
  return request("/api/auth/me", {}, token);
}

export async function fetchSites(token: string) {
  return request<Array<Record<string, unknown>>>("/api/sites", {}, token);
}

export async function fetchSiteSummary(siteId: string, token: string) {
  return request<Record<string, unknown>>(`/api/sites/${siteId}/summary`, {}, token);
}

export async function fetchPatients(siteId: string, token: string) {
  return request<Array<Record<string, unknown>>>(`/api/sites/${siteId}/patients`, {}, token);
}

export async function createPatient(
  siteId: string,
  token: string,
  payload: {
    patient_id: string;
    sex: string;
    age: number;
    chart_alias?: string;
    local_case_code?: string;
  }
) {
  return request<Record<string, unknown>>(`/api/sites/${siteId}/patients`, {
    method: "POST",
    body: JSON.stringify(payload),
  }, token);
}

export async function downloadManifest(siteId: string, token: string) {
  const response = await fetch(`${API_BASE_URL}/api/sites/${siteId}/manifest.csv`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error(`Manifest export failed: ${response.status}`);
  }
  return response.blob();
}
