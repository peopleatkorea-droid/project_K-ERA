import { persistMainAppToken, requestMainControlPlane } from "./main-control-plane-client";
import { canUseDesktopLocalApiTransport, requestDesktopLocalApiJson } from "./desktop-local-api";
import type { DesktopGoogleAuthExchangePayload, DesktopGoogleAuthStartResponse } from "./desktop-google-auth";
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

function requestDesktopPublicJson<T>(path: string) {
  return requestDesktopLocalApiJson<T>(path, "");
}

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

export async function startDesktopGoogleLogin(redirectUri: string): Promise<DesktopGoogleAuthStartResponse> {
  return requestMainControlPlane<DesktopGoogleAuthStartResponse>("/auth/desktop/start", {
    method: "POST",
    body: JSON.stringify({ redirect_uri: redirectUri }),
  });
}

export async function exchangeDesktopGoogleLogin(payload: DesktopGoogleAuthExchangePayload): Promise<AuthResponse> {
  return requestMainControlPlane<AuthResponse>("/auth/desktop/exchange", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchMe(token: string) {
  const auth = await requestMainControlPlane<AuthResponse>("/auth/me", {}, token);
  persistMainAppToken(auth.access_token);
  return auth.user;
}

export async function fetchMainBootstrap(token?: string) {
  const bootstrap = await requestMainControlPlane<MainBootstrapResponse>("/bootstrap", {}, token);
  persistMainAppToken(bootstrap.access_token);
  return {
    ...bootstrap,
    sites: filterVisibleSites(bootstrap.sites),
  };
}

export async function fetchSites(token?: string) {
  return filterVisibleSites(await requestMainControlPlane<SiteRecord[]>("/sites", {}, token));
}

export async function fetchPublicSites() {
  if (canUseDesktopLocalApiTransport()) {
    return filterVisibleSites(await requestDesktopPublicJson<SiteRecord[]>("/api/public/sites"));
  }
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
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopPublicJson<PublicInstitutionRecord[]>(`/api/public/institutions/search?${params.toString()}`);
  }
  return requestMainControlPlane<PublicInstitutionRecord[]>(`/public/institutions/search?${params.toString()}`);
}

export async function fetchPublicStatistics() {
  if (canUseDesktopLocalApiTransport()) {
    return requestDesktopPublicJson<PublicStatistics>("/api/public/statistics");
  }
  return requestMainControlPlane<PublicStatistics>("/public/statistics");
}

export async function fetchMyAccessRequests(token?: string) {
  return requestMainControlPlane<AccessRequestRecord[]>("/auth/access-requests", {}, token);
}

export async function submitAccessRequest(
  token: string | null | undefined,
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
    token ?? undefined,
  );
  persistMainAppToken(response.access_token);
  return response;
}
