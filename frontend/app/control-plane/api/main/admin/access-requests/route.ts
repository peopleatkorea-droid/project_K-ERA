import { NextRequest } from "next/server";

import { listMainAdminAccessRequests } from "../../../../../../lib/control-plane/main-app-bridge";
import { jsonError } from "../../../../../../lib/control-plane/http";

export async function GET(request: NextRequest) {
  try {
    const statusFilter = request.nextUrl.searchParams.get("status_filter");
    return Response.json(await listMainAdminAccessRequests(request, statusFilter));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load access requests.";
    return jsonError(message, 403);
  }
}
