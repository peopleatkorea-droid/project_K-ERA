import { NextRequest } from "next/server";

import { fetchMainAdminOverview } from "../../../../../../lib/control-plane/main-app-bridge";
import { jsonError } from "../../../../../../lib/control-plane/http";

export async function GET(request: NextRequest) {
  try {
    return Response.json(await fetchMainAdminOverview(request));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load admin overview.";
    return jsonError(message, 403);
  }
}
