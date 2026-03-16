import { request } from "./api-core";
import type {
  AccessRequestRecord,
  AuthResponse,
  AuthState,
  AuthUser,
  PublicInstitutionRecord,
  PublicStatistics,
  SiteRecord,
} from "./types";

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

export async function searchPublicInstitutions(
  query: string,
  options?: { sido_code?: string; sggu_code?: string; limit?: number },
) {
  const params = new URLSearchParams();
  if (query.trim()) {
    params.set("q", query.trim());
  }
  if (options?.sido_code) {
    params.set("sido_code", options.sido_code);
  }
  if (options?.sggu_code) {
    params.set("sggu_code", options.sggu_code);
  }
  params.set("limit", String(options?.limit ?? 12));
  return request<PublicInstitutionRecord[]>(`/api/public/institutions/search?${params.toString()}`);
}

export async function fetchPublicStatistics() {
  return request<PublicStatistics>("/api/public/statistics");
}

export async function fetchMyAccessRequests(token: string) {
  return request<AccessRequestRecord[]>("/api/auth/access-requests", {}, token);
}

export async function submitAccessRequest(
  token: string,
  payload: {
    requested_site_id: string;
    requested_site_label?: string;
    requested_role: string;
    message?: string;
  },
) {
  return request<{ request: AccessRequestRecord; auth_state: AuthState; user: AuthUser }>(
    "/api/auth/request-access",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    token,
  );
}
