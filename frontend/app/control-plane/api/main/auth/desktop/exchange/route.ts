import { NextRequest } from "next/server";

import { jsonError } from "../../../../../../../lib/control-plane/http";
import { exchangeMainDesktopGoogleAuth } from "../../../../../../../lib/control-plane/main-app-bridge-desktop-auth";

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
    return Response.json(await exchangeMainDesktopGoogleAuth(body), { headers: CORS_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Desktop Google authentication failed.";
    return jsonError(message, 401);
  }
}
