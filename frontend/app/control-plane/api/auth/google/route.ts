import { NextRequest } from "next/server";

import { verifyGoogleIdentityToken } from "../../../../../lib/control-plane/google";
import { jsonError, sessionResponse } from "../../../../../lib/control-plane/http";
import { ensureControlPlaneIdentity } from "../../../../../lib/control-plane/store";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { id_token?: string };
    const idToken = body.id_token?.trim() || "";
    if (!idToken) {
      return jsonError("id_token is required.");
    }
    const identity = await verifyGoogleIdentityToken(idToken);
    const user = await ensureControlPlaneIdentity(identity);
    return sessionResponse(user.user_id, { user });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google authentication failed.";
    return jsonError(message, 401);
  }
}

