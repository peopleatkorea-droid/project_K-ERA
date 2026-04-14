import { NextRequest } from "next/server";

import { fetchMainDesktopReleases } from "../../../../../../lib/control-plane/main-app-bridge";
import { authJsonResponse, jsonError } from "../../../../../../lib/control-plane/http";

export async function GET(request: NextRequest) {
  try {
    return authJsonResponse({ releases: await fetchMainDesktopReleases(request) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load desktop releases.";
    return jsonError(message, 401);
  }
}
