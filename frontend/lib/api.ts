export type AuthState = "approved" | "pending" | "rejected" | "application_required";

export type SiteRecord = {
  site_id: string;
  display_name: string;
  hospital_name: string;
};

export type AccessRequestRecord = {
  request_id: string;
  user_id: string;
  email: string;
  requested_site_id: string;
  requested_role: string;
  message: string;
  status: AuthState;
  reviewed_by: string | null;
  reviewer_notes: string;
  created_at: string;
  reviewed_at: string | null;
};

export type AuthUser = {
  user_id: string;
  username: string;
  full_name: string;
  role: string;
  site_ids: string[] | null;
  approval_status: AuthState;
  latest_access_request?: AccessRequestRecord | null;
};

export type AuthResponse = {
  auth_state: AuthState;
  access_token: string;
  token_type: "bearer";
  user: AuthUser;
};

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "http://127.0.0.1:8000";

async function request<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) {
    headers.set("Content-Type", headers.get("Content-Type") ?? "application/json");
  }
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

export async function login(username: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export async function googleLogin(idToken: string): Promise<AuthResponse> {
  return request<AuthResponse>("/api/auth/google", {
    method: "POST",
    body: JSON.stringify({ id_token: idToken }),
  });
}

export async function fetchMe(token: string) {
  return request<AuthUser>("/api/auth/me", {}, token);
}

export async function fetchSites(token: string) {
  return request<SiteRecord[]>("/api/sites", {}, token);
}

export async function fetchPublicSites() {
  return request<SiteRecord[]>("/api/public/sites");
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
  return request<Record<string, unknown>>(
    `/api/sites/${siteId}/patients`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    token
  );
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

export async function fetchMyAccessRequests(token: string) {
  return request<AccessRequestRecord[]>("/api/auth/access-requests", {}, token);
}

export async function submitAccessRequest(
  token: string,
  payload: {
    requested_site_id: string;
    requested_role: string;
    message?: string;
  }
) {
  return request<{ request: AccessRequestRecord; auth_state: AuthState; user: AuthUser }>(
    "/api/auth/request-access",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    token
  );
}

export async function fetchAccessRequests(token: string, statusFilter = "pending") {
  const suffix = statusFilter ? `?status_filter=${encodeURIComponent(statusFilter)}` : "";
  return request<AccessRequestRecord[]>(`/api/admin/access-requests${suffix}`, {}, token);
}

export async function reviewAccessRequest(
  requestId: string,
  token: string,
  payload: {
    decision: "approved" | "rejected";
    assigned_role?: string;
    assigned_site_id?: string;
    reviewer_notes?: string;
  }
) {
  return request<{ request: AccessRequestRecord }>(
    `/api/admin/access-requests/${requestId}/review`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    token
  );
}
