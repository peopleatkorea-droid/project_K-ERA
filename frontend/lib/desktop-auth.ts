"use client";

import { request } from "./api-core";
import type { AuthResponse, AuthUser, SiteRecord } from "./types";
import { filterVisibleSites } from "./site-labels";

export const DESKTOP_TOKEN_KEY = "kera_desktop_token";

export async function desktopLocalLogin(username: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export async function desktopLocalDevLogin(): Promise<AuthResponse> {
  return request<AuthResponse>("/api/auth/dev-login", {
    method: "POST",
  });
}

export async function desktopFetchCurrentUser(token: string): Promise<AuthUser> {
  return request<AuthUser>("/api/auth/me", {}, token);
}

export async function desktopFetchApprovedSites(token: string): Promise<SiteRecord[]> {
  return filterVisibleSites(await request<SiteRecord[]>("/api/sites", {}, token));
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
