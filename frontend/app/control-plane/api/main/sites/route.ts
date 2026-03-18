import { NextRequest } from "next/server";

import { fetchSitesForMainUser } from "../../../../../lib/control-plane/main-app-bridge";
import { jsonError } from "../../../../../lib/control-plane/http";

export async function GET(request: NextRequest) {
  try {
    return Response.json(await fetchSitesForMainUser(request));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load accessible sites.";
    return jsonError(message, 401);
  }
}
