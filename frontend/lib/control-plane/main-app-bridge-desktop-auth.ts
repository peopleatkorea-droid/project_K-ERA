import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { jwtVerify, SignJWT } from "jose";

import type { AuthResponse } from "../types";
import { controlPlaneSessionSecret } from "./config";
import { verifyGoogleIdentityToken } from "./google";
import { trimText } from "./main-app-bridge-shared";
import { buildMainAuthResponse } from "./main-app-bridge-users";
import { ensureControlPlaneIdentity } from "./store";

const GOOGLE_DESKTOP_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_DESKTOP_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_OPENID_SCOPE = "openid email profile";
const DESKTOP_GOOGLE_FLOW_PURPOSE = "desktop_google_auth";
const DESKTOP_GOOGLE_FLOW_TTL_SECONDS = 60 * 10;
const DESKTOP_GOOGLE_LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

type DesktopGoogleAuthStartPayload = {
  redirect_uri?: string;
};

type DesktopGoogleAuthExchangePayload = {
  code?: string;
  flow_token?: string;
  redirect_uri?: string;
  state?: string;
};

type DesktopGoogleAuthStartResponse = {
  authorization_url: string;
  flow_token: string;
  redirect_uri: string;
  state: string;
};

type DesktopGoogleFlowClaims = {
  client_id?: string;
  code_verifier?: string;
  purpose?: string;
  redirect_uri?: string;
  state?: string;
};

type GoogleTokenExchangeResponse = {
  error?: string;
  error_description?: string;
  id_token?: string;
};

function flowTokenKey(): Uint8Array {
  return new TextEncoder().encode(controlPlaneSessionSecret());
}

function base64UrlEncode(value: Uint8Array | Buffer): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createPkcePair(): { codeChallenge: string; codeVerifier: string } {
  const codeVerifier = base64UrlEncode(randomBytes(32));
  const codeChallenge = base64UrlEncode(createHash("sha256").update(codeVerifier).digest());
  return { codeChallenge, codeVerifier };
}

function createState(): string {
  return base64UrlEncode(randomBytes(24));
}

function desktopGoogleClientId(): string {
  return (
    trimText(process.env.KERA_GOOGLE_DESKTOP_CLIENT_ID) ||
    trimText(process.env.NEXT_PUBLIC_GOOGLE_DESKTOP_CLIENT_ID) ||
    ""
  );
}

function desktopGoogleClientSecret(): string {
  return (
    trimText(process.env.KERA_GOOGLE_DESKTOP_CLIENT_SECRET) ||
    trimText(process.env.GOOGLE_DESKTOP_CLIENT_SECRET) ||
    trimText(process.env.KERA_GOOGLE_CLIENT_SECRET) ||
    trimText(process.env.GOOGLE_CLIENT_SECRET) ||
    ""
  );
}

function requireDesktopGoogleOAuthConfig(): { clientId: string; clientSecret: string } {
  const clientId = desktopGoogleClientId();
  const clientSecret = desktopGoogleClientSecret();
  if (!clientId) {
    throw new Error("Desktop Google OAuth is not configured. Set KERA_GOOGLE_DESKTOP_CLIENT_ID.");
  }
  if (!clientSecret) {
    throw new Error("Desktop Google OAuth is not configured. Set KERA_GOOGLE_DESKTOP_CLIENT_SECRET.");
  }
  return { clientId, clientSecret };
}

function validateDesktopRedirectUri(rawRedirectUri: string): string {
  const redirectUri = trimText(rawRedirectUri);
  if (!redirectUri) {
    throw new Error("redirect_uri is required.");
  }
  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    throw new Error("Desktop Google redirect_uri is invalid.");
  }
  if (parsed.protocol !== "http:") {
    throw new Error("Desktop Google redirect_uri must use http.");
  }
  if (!DESKTOP_GOOGLE_LOOPBACK_HOSTS.has(parsed.hostname)) {
    throw new Error("Desktop Google redirect_uri must use a loopback host.");
  }
  const port = Number(parsed.port || 0);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error("Desktop Google redirect_uri must include a valid port.");
  }
  if (parsed.pathname && parsed.pathname !== "/") {
    throw new Error("Desktop Google redirect_uri path is invalid.");
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new Error("Desktop Google redirect_uri is invalid.");
  }
  return parsed.origin;
}

function buildDesktopGoogleAuthorizationUrl(args: {
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  state: string;
}): string {
  const params = new URLSearchParams({
    client_id: args.clientId,
    code_challenge: args.codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
    redirect_uri: args.redirectUri,
    response_type: "code",
    scope: GOOGLE_OPENID_SCOPE,
    state: args.state,
  });
  return `${GOOGLE_DESKTOP_AUTH_ENDPOINT}?${params.toString()}`;
}

async function createDesktopGoogleFlowToken(claims: {
  clientId: string;
  codeVerifier: string;
  redirectUri: string;
  state: string;
}): Promise<string> {
  return new SignJWT({
    client_id: claims.clientId,
    code_verifier: claims.codeVerifier,
    purpose: DESKTOP_GOOGLE_FLOW_PURPOSE,
    redirect_uri: claims.redirectUri,
    state: claims.state,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${DESKTOP_GOOGLE_FLOW_TTL_SECONDS}s`)
    .sign(flowTokenKey());
}

async function readDesktopGoogleFlowToken(flowToken: string): Promise<{
  clientId: string;
  codeVerifier: string;
  redirectUri: string;
  state: string;
}> {
  const normalizedFlowToken = trimText(flowToken);
  if (!normalizedFlowToken) {
    throw new Error("flow_token is required.");
  }
  let payload: DesktopGoogleFlowClaims;
  try {
    payload = (await jwtVerify<DesktopGoogleFlowClaims>(normalizedFlowToken, flowTokenKey())).payload;
  } catch {
    throw new Error("Desktop Google auth flow has expired. Retry sign-in.");
  }
  const purpose = trimText(payload.purpose);
  const clientId = trimText(payload.client_id);
  const codeVerifier = trimText(payload.code_verifier);
  const redirectUri = validateDesktopRedirectUri(payload.redirect_uri || "");
  const state = trimText(payload.state);
  if (purpose !== DESKTOP_GOOGLE_FLOW_PURPOSE || !clientId || !codeVerifier || !state) {
    throw new Error("Desktop Google auth flow is invalid.");
  }
  return { clientId, codeVerifier, redirectUri, state };
}

async function exchangeGoogleAuthorizationCode(args: {
  clientId: string;
  clientSecret: string;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<string> {
  const response = await fetch(GOOGLE_DESKTOP_TOKEN_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: args.clientId,
      client_secret: args.clientSecret,
      code: args.code,
      code_verifier: args.codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: args.redirectUri,
    }),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as GoogleTokenExchangeResponse;
  if (!response.ok) {
    const detail = trimText(payload.error_description) || trimText(payload.error);
    throw new Error(detail ? `Google token exchange failed: ${detail}` : "Google token exchange failed.");
  }
  const idToken = trimText(payload.id_token);
  if (!idToken) {
    throw new Error("Google login did not return an ID token.");
  }
  return idToken;
}

async function loginMainWithDesktopGoogleIdToken(idToken: string): Promise<AuthResponse> {
  const identity = await verifyGoogleIdentityToken(idToken);
  const user = await ensureControlPlaneIdentity(identity);
  const auth = await buildMainAuthResponse(user.user_id, {
    full_name: user.full_name,
    username: user.email,
  });
  if (auth.user.role === "admin" || auth.user.role === "site_admin") {
    throw new Error("Admin and site admin accounts must use local password sign-in.");
  }
  return auth;
}

export async function startMainDesktopGoogleAuth(
  payload: DesktopGoogleAuthStartPayload,
): Promise<DesktopGoogleAuthStartResponse> {
  const { clientId } = requireDesktopGoogleOAuthConfig();
  const redirectUri = validateDesktopRedirectUri(payload.redirect_uri || "");
  const { codeChallenge, codeVerifier } = createPkcePair();
  const state = createState();
  const flowToken = await createDesktopGoogleFlowToken({
    clientId,
    codeVerifier,
    redirectUri,
    state,
  });
  return {
    authorization_url: buildDesktopGoogleAuthorizationUrl({
      clientId,
      codeChallenge,
      redirectUri,
      state,
    }),
    flow_token: flowToken,
    redirect_uri: redirectUri,
    state,
  };
}

export async function exchangeMainDesktopGoogleAuth(
  payload: DesktopGoogleAuthExchangePayload,
): Promise<AuthResponse> {
  const { clientId, clientSecret } = requireDesktopGoogleOAuthConfig();
  const code = trimText(payload.code);
  const returnedState = trimText(payload.state);
  const returnedRedirectUri = validateDesktopRedirectUri(payload.redirect_uri || "");
  if (!code) {
    throw new Error("code is required.");
  }
  if (!returnedState) {
    throw new Error("state is required.");
  }
  const flow = await readDesktopGoogleFlowToken(payload.flow_token || "");
  if (flow.clientId !== clientId) {
    throw new Error("Desktop Google OAuth configuration changed. Retry sign-in.");
  }
  if (flow.redirectUri !== returnedRedirectUri) {
    throw new Error("Desktop Google redirect_uri mismatch.");
  }
  if (flow.state !== returnedState) {
    throw new Error("Google OAuth state mismatch.");
  }
  const idToken = await exchangeGoogleAuthorizationCode({
    clientId,
    clientSecret,
    code,
    codeVerifier: flow.codeVerifier,
    redirectUri: flow.redirectUri,
  });
  return loginMainWithDesktopGoogleIdToken(idToken);
}
