import { NextRequest } from "next/server";

import { loginMainWithLocalCredentials } from "../../../../../../lib/control-plane/main-app-bridge";
import { authJsonResponse, jsonError } from "../../../../../../lib/control-plane/http";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      username?: string;
      password?: string;
    };
    return authJsonResponse(await loginMainWithLocalCredentials(request, body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to sign in.";
    return jsonError(message, 400);
  }
}
