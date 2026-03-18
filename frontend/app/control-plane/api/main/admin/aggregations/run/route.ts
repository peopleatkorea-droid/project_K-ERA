import { NextRequest } from "next/server";

import { runMainFederatedAggregation } from "../../../../../../../lib/control-plane/main-app-bridge";
import { jsonError } from "../../../../../../../lib/control-plane/http";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      update_ids?: string[];
      new_version_name?: string;
    };
    return Response.json(await runMainFederatedAggregation(request, body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to run federated aggregation.";
    return jsonError(message, 400);
  }
}
