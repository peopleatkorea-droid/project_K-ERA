import { NextRequest } from "next/server";

import { fetchPublicStatistics } from "../../../../../../lib/control-plane/main-app-bridge";
import { jsonError } from "../../../../../../lib/control-plane/http";

export async function GET(request: NextRequest) {
  try {
    return Response.json(await fetchPublicStatistics(request));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load public statistics.";
    return jsonError(message, 400);
  }
}
