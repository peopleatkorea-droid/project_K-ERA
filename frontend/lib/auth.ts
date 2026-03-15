import { request } from "./api-core";
import type { AccessRequestRecord, AuthResponse, AuthState, AuthUser, SiteRecord } from "./types";

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

export async function fetchMyAccessRequests(token: string) {
  return request<AccessRequestRecord[]>("/api/auth/access-requests", {}, token);
}

export async function submitAccessRequest(
  token: string,
  payload: {
    requested_site_id: string;
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
