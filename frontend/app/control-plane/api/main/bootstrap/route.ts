import { NextRequest } from "next/server";

import { fetchMainBootstrap } from "../../../../../lib/control-plane/main-app-bridge";
import { authJsonResponse, jsonError } from "../../../../../lib/control-plane/http";

export async function GET(request: NextRequest) {
  try {
    return authJsonResponse(await fetchMainBootstrap(request));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to bootstrap the current workspace.";
    return jsonError(message, 401);
  }
}
