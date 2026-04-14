"use client";

import { hasDesktopRuntime, invokeDesktop, listenDesktopEvent } from "./desktop-ipc";

const GOOGLE_OAUTH_REDIRECT_EVENT = "kera://oauth-redirect";
const GOOGLE_OAUTH_TIMEOUT_MS = 120_000;
const DESKTOP_GOOGLE_LOOPBACK_HOSTS = ["127.0.0.1", "localhost", "::1", "[::1]"];
const DEFAULT_DESKTOP_GOOGLE_WEB_LOGIN_ROOT = "https://k-era.org";

type GoogleOAuthServerResponse = {
  port: number;
};

export type DesktopGoogleAuthStartResponse = {
  authorization_url: string;
  flow_token: string;
  redirect_uri: string;
  state: string;
};

export type DesktopGoogleAuthExchangePayload = {
  code: string;
  flow_token: string;
  redirect_uri: string;
  state: string;
};

export type DesktopGoogleAuthClient<T> = {
  exchangeLogin: (payload: DesktopGoogleAuthExchangePayload) => Promise<T>;
  startLogin: (payload: { redirect_uri: string }) => Promise<DesktopGoogleAuthStartResponse>;
};

export type DesktopGoogleBrowserAuthClient<T> = {
  exchangeLogin: (idToken: string) => Promise<T>;
};

export function canUseDesktopGoogleAuth(): boolean {
  return hasDesktopRuntime();
}

export function parseDesktopGoogleRedirectUrl(
  redirectUrl: string,
  expectedPort: number,
  expectedState: string,
): { code: string; state: string } {
  let parsed: URL;
  try {
    parsed = new URL(redirectUrl);
  } catch {
    throw new Error("Google OAuth redirect URL is invalid.");
  }
  if (!DESKTOP_GOOGLE_LOOPBACK_HOSTS.includes(parsed.hostname)) {
    throw new Error("Google OAuth redirect host is invalid.");
  }
  if (parsed.port !== String(expectedPort)) {
    throw new Error("Google OAuth redirect port is invalid.");
  }
  const returnedState = parsed.searchParams.get("state")?.trim() || "";
  if (!returnedState || returnedState !== expectedState) {
    throw new Error("Google OAuth state mismatch.");
  }
  const oauthError = parsed.searchParams.get("error")?.trim() || "";
  if (oauthError) {
    const description = parsed.searchParams.get("error_description")?.trim() || oauthError;
    throw new Error(description);
  }
  const code = parsed.searchParams.get("code")?.trim() || "";
  if (!code) {
    throw new Error("Google OAuth did not return an authorization code.");
  }
  return { code, state: returnedState };
}

export function parseDesktopGoogleBrowserRedirectUrl(
  redirectUrl: string,
  expectedPort: number,
  expectedState: string,
): { idToken: string; state: string } {
  let parsed: URL;
  try {
    parsed = new URL(redirectUrl);
  } catch {
    throw new Error("Google login redirect URL is invalid.");
  }
  if (!DESKTOP_GOOGLE_LOOPBACK_HOSTS.includes(parsed.hostname)) {
    throw new Error("Google login redirect host is invalid.");
  }
  if (parsed.port !== String(expectedPort)) {
    throw new Error("Google login redirect port is invalid.");
  }
  const returnedState = parsed.searchParams.get("state")?.trim() || "";
  if (!returnedState || returnedState !== expectedState) {
    throw new Error("Google login state mismatch.");
  }
  const oauthError = parsed.searchParams.get("error")?.trim() || "";
  if (oauthError) {
    const description = parsed.searchParams.get("error_description")?.trim() || oauthError;
    throw new Error(description);
  }
  const idToken = parsed.searchParams.get("credential")?.trim() || parsed.searchParams.get("id_token")?.trim() || "";
  if (!idToken) {
    throw new Error("Google login did not return a credential.");
  }
  return { idToken, state: returnedState };
}

function normalizeDesktopRedirectUri(redirectUri: string, expectedPort: number): string {
  let parsed: URL;
  try {
    parsed = new URL(String(redirectUri || ""));
  } catch {
    throw new Error("Desktop Google redirect_uri is invalid.");
  }
  if (!DESKTOP_GOOGLE_LOOPBACK_HOSTS.includes(parsed.hostname)) {
    throw new Error("Desktop Google redirect_uri host is invalid.");
  }
  if (parsed.protocol !== "http:") {
    throw new Error("Desktop Google redirect_uri must use http.");
  }
  if (parsed.port !== String(expectedPort)) {
    throw new Error("Desktop Google redirect_uri port is invalid.");
  }
  return parsed.origin;
}

async function waitForDesktopGoogleRedirect(): Promise<{
  cleanup: () => Promise<void>;
  port: number;
  redirectPromise: Promise<string>;
}> {
  let resolveRedirect: ((value: string) => void) | null = null;
  let rejectRedirect: ((reason?: unknown) => void) | null = null;
  const redirectPromise = new Promise<string>((resolve, reject) => {
    resolveRedirect = resolve;
    rejectRedirect = reject;
  });
  const unlisten = await listenDesktopEvent<string>(GOOGLE_OAUTH_REDIRECT_EVENT, (payload) => {
    resolveRedirect?.(String(payload ?? ""));
  });
  let port = 0;
  const timeoutId = window.setTimeout(() => {
    rejectRedirect?.(new Error("Google login timed out."));
  }, GOOGLE_OAUTH_TIMEOUT_MS);
  try {
    const response = await invokeDesktop<GoogleOAuthServerResponse>("start_google_oauth_server");
    port = Number(response.port || 0);
    if (!Number.isFinite(port) || port <= 0) {
      throw new Error("Desktop OAuth server did not return a valid port.");
    }
  } catch (error) {
    window.clearTimeout(timeoutId);
    unlisten();
    throw error;
  }
  return {
    port,
    redirectPromise,
    cleanup: async () => {
      window.clearTimeout(timeoutId);
      unlisten();
      if (port > 0) {
        await invokeDesktop("cancel_google_oauth_server", { port }).catch(() => undefined);
      }
    },
  };
}

function createDesktopGoogleBrowserState(): string {
  const values = new Uint8Array(16);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("");
}

function normalizeDesktopGoogleWebLoginRoot(rawRoot?: string): string {
  const normalized = String(rawRoot ?? "").trim().replace(/\/+$/, "");
  if (!normalized) {
    return DEFAULT_DESKTOP_GOOGLE_WEB_LOGIN_ROOT;
  }
  if (normalized.endsWith("/control-plane/api")) {
    return normalized.slice(0, -"/control-plane/api".length);
  }
  if (normalized.endsWith("/api")) {
    return normalized.slice(0, -"/api".length);
  }
  return normalized;
}

export async function authenticateWithDesktopGoogle<T>(
  client: DesktopGoogleAuthClient<T>,
): Promise<T> {
  if (!hasDesktopRuntime()) {
    throw new Error("Desktop runtime is unavailable.");
  }

  const { cleanup, port, redirectPromise } = await waitForDesktopGoogleRedirect();
  const localRedirectUri = `http://127.0.0.1:${port}`;

  try {
    const startResponse = await client.startLogin({ redirect_uri: localRedirectUri });
    const authorizationUrl = String(startResponse.authorization_url ?? "").trim();
    const flowToken = String(startResponse.flow_token ?? "").trim();
    const state = String(startResponse.state ?? "").trim();
    const redirectUri = normalizeDesktopRedirectUri(String(startResponse.redirect_uri ?? localRedirectUri), port);
    if (!authorizationUrl) {
      throw new Error("Desktop Google authorization URL is missing.");
    }
    if (!flowToken) {
      throw new Error("Desktop Google auth flow token is missing.");
    }
    if (!state) {
      throw new Error("Desktop Google auth state is missing.");
    }
    await invokeDesktop("open_external_url", { url: authorizationUrl });
    const redirectUrl = await redirectPromise;
    const { code, state: returnedState } = parseDesktopGoogleRedirectUrl(redirectUrl, port, state);
    return await client.exchangeLogin({
      code,
      flow_token: flowToken,
      redirect_uri: redirectUri,
      state: returnedState,
    });
  } finally {
    await cleanup();
  }
}

export async function authenticateWithDesktopGoogleViaWebLogin<T>(
  client: DesktopGoogleBrowserAuthClient<T>,
  options: {
    locale?: string;
    publicRoot?: string;
  } = {},
): Promise<T> {
  if (!hasDesktopRuntime()) {
    throw new Error("Desktop runtime is unavailable.");
  }

  const { cleanup, port, redirectPromise } = await waitForDesktopGoogleRedirect();
  const state = createDesktopGoogleBrowserState();
  const callbackUrl = new URL(`http://127.0.0.1:${port}/desktop-google-login`);
  const publicRoot = normalizeDesktopGoogleWebLoginRoot(options.publicRoot);
  const loginUrl = new URL("/desktop-google-login", `${publicRoot}/`);
  loginUrl.searchParams.set("return_to", callbackUrl.toString());
  loginUrl.searchParams.set("state", state);
  if (options.locale?.trim()) {
    loginUrl.searchParams.set("locale", options.locale.trim());
  }

  try {
    await invokeDesktop("open_external_url", { url: loginUrl.toString() });
    const redirectUrl = await redirectPromise;
    const { idToken } = parseDesktopGoogleBrowserRedirectUrl(redirectUrl, port, state);
    return await client.exchangeLogin(idToken);
  } finally {
    await cleanup();
  }
}
