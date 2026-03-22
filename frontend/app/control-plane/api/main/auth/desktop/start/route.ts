import { NextRequest } from "next/server";

import { jsonError } from "../../../../../../../lib/control-plane/http";
import { startMainDesktopGoogleAuth } from "../../../../../../../lib/control-plane/main-app-bridge-desktop-auth";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { redirect_uri?: string };
    return Response.json(await startMainDesktopGoogleAuth(body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Desktop Google sign-in could not start.";
    return jsonError(message, 400);
  }
}
