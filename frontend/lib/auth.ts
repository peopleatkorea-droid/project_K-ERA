import { persistMainAppToken, requestMainControlPlane } from "./main-control-plane-client";
import type {
  AccessRequestRecord,
  AuthResponse,
  AuthState,
  MainBootstrapResponse,
  AuthUser,
  PublicInstitutionRecord,
  PublicStatistics,
  SiteRecord,
} from "./types";
import { filterVisibleSites } from "./site-labels";

export async function login(username: string, password: string): Promise<AuthResponse> {
  return requestMainControlPlane<AuthResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export async function devLogin(): Promise<AuthResponse> {
  return requestMainControlPlane<AuthResponse>("/auth/dev-login", {
    method: "POST",
  });
}

export async function googleLogin(idToken: string): Promise<AuthResponse> {
  return requestMainControlPlane<AuthResponse>("/auth/google", {
    method: "POST",
    body: JSON.stringify({ id_token: idToken }),
  });
}

export async function fetchMe(token: string) {
  const auth = await requestMainControlPlane<AuthResponse>("/auth/me", {}, token);
  persistMainAppToken(auth.access_token);
  return auth.user;
}

export async function fetchMainBootstrap(token: string) {
  const bootstrap = await requestMainControlPlane<MainBootstrapResponse>("/bootstrap", {}, token);
  persistMainAppToken(bootstrap.access_token);
  return {
    ...bootstrap,
    sites: filterVisibleSites(bootstrap.sites),
  };
}

export async function fetchSites(token: string) {
  return filterVisibleSites(await requestMainControlPlane<SiteRecord[]>("/sites", {}, token));
}

export async function fetchPublicSites() {
  return filterVisibleSites(await requestMainControlPlane<SiteRecord[]>("/public/sites"));
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
  return requestMainControlPlane<PublicInstitutionRecord[]>(`/public/institutions/search?${params.toString()}`);
}

export async function fetchPublicStatistics() {
  return requestMainControlPlane<PublicStatistics>("/public/statistics");
}

export async function fetchMyAccessRequests(token: string) {
  return requestMainControlPlane<AccessRequestRecord[]>("/auth/access-requests", {}, token);
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
  const response = await requestMainControlPlane<
    { request: AccessRequestRecord; auth_state: AuthState; user: AuthUser; access_token?: string }
  >(
    "/auth/request-access",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    token,
  );
  persistMainAppToken(response.access_token);
  return response;
}
