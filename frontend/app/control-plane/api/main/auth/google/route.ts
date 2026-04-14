import { NextRequest } from "next/server";

import { loginMainWithGoogle } from "../../../../../../lib/control-plane/main-app-bridge";
import { authJsonResponse, jsonError } from "../../../../../../lib/control-plane/http";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { id_token?: string };
    return authJsonResponse(await loginMainWithGoogle(request, body.id_token || ""));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google authentication failed.";
    return jsonError(message, 401);
  }
}
