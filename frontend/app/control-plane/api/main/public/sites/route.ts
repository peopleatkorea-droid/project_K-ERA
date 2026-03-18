import { NextRequest } from "next/server";

import { listPublicSites } from "../../../../../../lib/control-plane/main-app-bridge";
import { jsonError } from "../../../../../../lib/control-plane/http";

export async function GET(request: NextRequest) {
  try {
    return Response.json(await listPublicSites(request));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load public sites.";
    return jsonError(message, 400);
  }
}
