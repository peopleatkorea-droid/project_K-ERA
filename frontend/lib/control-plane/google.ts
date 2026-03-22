import { OAuth2Client } from "google-auth-library";

import type { ControlPlaneIdentity } from "./types";

let cachedClient: OAuth2Client | null = null;

function googleClientIds(): string[] {
  const values = new Set<string>();
  for (const rawValue of [
    process.env.KERA_GOOGLE_DESKTOP_CLIENT_ID,
    process.env.NEXT_PUBLIC_GOOGLE_DESKTOP_CLIENT_ID,
    process.env.KERA_GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_ID,
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
    process.env.KERA_GOOGLE_CLIENT_IDS,
  ]) {
    for (const entry of String(rawValue ?? "").split(",")) {
      const normalized = entry.trim();
      if (normalized) {
        values.add(normalized);
      }
    }
  }
  return Array.from(values);
}

function oauthClient(): OAuth2Client {
  if (cachedClient) {
    return cachedClient;
  }
  cachedClient = new OAuth2Client();
  return cachedClient;
}

export async function verifyGoogleIdentityToken(idToken: string): Promise<ControlPlaneIdentity> {
  const clientIds = googleClientIds();
  if (clientIds.length === 0) {
    throw new Error("Google authentication is not configured.");
  }
  const ticket = await oauthClient().verifyIdToken({
    idToken,
    audience: clientIds,
  });
  const payload = ticket.getPayload();
  const email = payload?.email?.trim().toLowerCase();
  const googleSub = payload?.sub?.trim();
  if (!payload || !email || !googleSub) {
    throw new Error("Google identity token is missing email or subject.");
  }
  if (!payload.email_verified) {
    throw new Error("Google account email is not verified.");
  }
  return {
    email,
    googleSub,
    fullName: payload.name?.trim() || email.split("@")[0],
  };
}
