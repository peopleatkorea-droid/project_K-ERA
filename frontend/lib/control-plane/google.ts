import { OAuth2Client } from "google-auth-library";

import type { ControlPlaneIdentity } from "./types";

let cachedClient: OAuth2Client | null = null;

function googleClientId(): string {
  return (
    process.env.KERA_GOOGLE_CLIENT_ID?.trim() ||
    process.env.GOOGLE_CLIENT_ID?.trim() ||
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() ||
    ""
  );
}

function oauthClient(): OAuth2Client {
  if (cachedClient) {
    return cachedClient;
  }
  cachedClient = new OAuth2Client(googleClientId());
  return cachedClient;
}

export async function verifyGoogleIdentityToken(idToken: string): Promise<ControlPlaneIdentity> {
  const clientId = googleClientId();
  if (!clientId) {
    throw new Error("Google authentication is not configured.");
  }
  const ticket = await oauthClient().verifyIdToken({
    idToken,
    audience: clientId,
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
