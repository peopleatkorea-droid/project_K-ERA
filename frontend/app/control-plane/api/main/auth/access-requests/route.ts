import { NextRequest } from "next/server";

import { fetchMyAccessRequests } from "../../../../../../lib/control-plane/main-app-bridge";
import { jsonError } from "../../../../../../lib/control-plane/http";

export async function GET(request: NextRequest) {
  try {
    return Response.json(await fetchMyAccessRequests(request));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load your access requests.";
    return jsonError(message, 401);
  }
}
