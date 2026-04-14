import { NextRequest } from "next/server";

import { exchangeMainDesktopGoogleAuth } from "../../../../../../../lib/control-plane/main-app-bridge-desktop-auth";
import { authJsonResponse, jsonError } from "../../../../../../../lib/control-plane/http";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      code?: string;
      flow_token?: string;
      redirect_uri?: string;
      state?: string;
    };
    const response = authJsonResponse(await exchangeMainDesktopGoogleAuth(body));
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      response.headers.set(key, value);
    }
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Desktop Google authentication failed.";
    const response = jsonError(message, 401);
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      response.headers.set(key, value);
    }
    return response;
  }
}
