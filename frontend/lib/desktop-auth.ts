"use client";

import { request } from "./api-core";
import { hasDesktopRuntime, invokeDesktop } from "./desktop-ipc";
import { requestDesktopLocalApiJson } from "./desktop-local-api";
import type { DesktopGoogleAuthExchangePayload, DesktopGoogleAuthStartResponse } from "./desktop-google-auth";
import type { AuthResponse, AuthUser, SiteRecord } from "./types";
import { filterVisibleSites } from "./site-labels";

type SessionCachePayload = {
  token: string;
  user: AuthUser;
  sites: SiteRecord[];
};

export async function loadDesktopSessionCache(): Promise<SessionCachePayload | null> {
  if (!hasDesktopRuntime()) return null;
  try {
    return await invokeDesktop<SessionCachePayload | null>("load_session_cache");
  } catch {
    return null;
  }
}

export async function saveDesktopSessionCache(payload: SessionCachePayload): Promise<void> {
  if (!hasDesktopRuntime()) return;
  try {
    await invokeDesktop("save_session_cache", { payload });
  } catch {
    // non-critical — proceed even if save fails
  }
}

export async function clearDesktopSessionCache(): Promise<void> {
  if (!hasDesktopRuntime()) return;
  try {
    await invokeDesktop("clear_session_cache");
  } catch {
    // non-critical
  }
}

export const DESKTOP_TOKEN_KEY = "kera_desktop_token";

async function requestDesktopAuthJson<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    body?: unknown;
  } = {},
  token = "",
): Promise<T> {
  if (hasDesktopRuntime()) {
    return requestDesktopLocalApiJson<T>(path, token, {
      method: options.method,
      body: options.body,
    });
  }
  return request<T>(
    path,
    {
      method: options.method,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    },
    token || undefined,
  );
}

export async function desktopLocalLogin(username: string, password: string): Promise<AuthResponse> {
  return requestDesktopAuthJson<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: { username, password },
  });
}

export async function desktopLocalDevLogin(): Promise<AuthResponse> {
  return requestDesktopAuthJson<AuthResponse>("/api/auth/dev-login", {
    method: "POST",
  });
}

export async function desktopGoogleLogin(idToken: string): Promise<AuthResponse> {
  return requestDesktopAuthJson<AuthResponse>("/api/auth/google", {
    method: "POST",
    body: { id_token: idToken },
  });
}

export async function startDesktopGoogleLogin(redirectUri: string): Promise<DesktopGoogleAuthStartResponse> {
  return requestDesktopAuthJson<DesktopGoogleAuthStartResponse>("/api/auth/desktop/start", {
    method: "POST",
    body: { redirect_uri: redirectUri },
  });
}

export async function exchangeDesktopGoogleLogin(payload: DesktopGoogleAuthExchangePayload): Promise<AuthResponse> {
  return requestDesktopAuthJson<AuthResponse>("/api/auth/desktop/exchange", {
    method: "POST",
    body: payload,
  });
}

export async function desktopFetchCurrentUser(token: string): Promise<AuthUser> {
  return requestDesktopAuthJson<AuthUser>("/api/auth/me", {}, token);
}

export async function desktopFetchApprovedSites(token: string): Promise<SiteRecord[]> {
  return filterVisibleSites(await requestDesktopAuthJson<SiteRecord[]>("/api/sites", {}, token));
}

export function persistDesktopSession(token: string | null | undefined) {
  if (typeof window === "undefined") {
    return;
  }
  const nextToken = String(token ?? "").trim();
  if (!nextToken) {
    window.localStorage.removeItem(DESKTOP_TOKEN_KEY);
    return;
  }
  window.localStorage.setItem(DESKTOP_TOKEN_KEY, nextToken);
}

export function clearDesktopSession() {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(DESKTOP_TOKEN_KEY);
}
