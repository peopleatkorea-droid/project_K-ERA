import { NextRequest } from "next/server";

import { listMainAggregations } from "../../../../../../lib/control-plane/main-app-bridge";
import { jsonError } from "../../../../../../lib/control-plane/http";

export async function GET(request: NextRequest) {
  try {
    return Response.json(await listMainAggregations(request));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load aggregations.";
    return jsonError(message, 403);
  }
}
