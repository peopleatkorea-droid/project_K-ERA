import { NextRequest } from "next/server";

import { jsonError } from "../../../../../../../lib/control-plane/http";
import { exchangeMainDesktopGoogleAuth } from "../../../../../../../lib/control-plane/main-app-bridge-desktop-auth";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      code?: string;
      flow_token?: string;
      redirect_uri?: string;
      state?: string;
    };
    return Response.json(await exchangeMainDesktopGoogleAuth(body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Desktop Google authentication failed.";
    return jsonError(message, 401);
  }
}
