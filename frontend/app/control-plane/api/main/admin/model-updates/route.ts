import { NextRequest } from "next/server";

import { listMainModelUpdates } from "../../../../../../lib/control-plane/main-app-bridge";
import { jsonError } from "../../../../../../lib/control-plane/http";

export async function GET(request: NextRequest) {
  try {
    const siteId = request.nextUrl.searchParams.get("site_id");
    const statusFilter = request.nextUrl.searchParams.get("status_filter");
    return Response.json(
      await listMainModelUpdates(request, {
        siteId,
        statusFilter,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load model updates.";
    return jsonError(message, 403);
  }
}
