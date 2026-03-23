import { NextRequest } from "next/server";

import { startMainDesktopGoogleAuth } from "../../../../../../../lib/control-plane/main-app-bridge-desktop-auth";

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
    const body = (await request.json()) as { redirect_uri?: string };
    return Response.json(await startMainDesktopGoogleAuth(body), { headers: CORS_HEADERS });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Desktop Google sign-in could not start.";
    return Response.json({ detail: message }, { status: 400, headers: CORS_HEADERS });
  }
}
