import { NextRequest } from "next/server";

import { jsonError } from "../../../../../lib/control-plane/http";
import { buildBootstrapForNode } from "../../../../../lib/control-plane/store";

export async function GET(request: NextRequest) {
  try {
    const nodeId = request.headers.get("x-kera-node-id")?.trim() || "";
    const nodeToken = request.headers.get("x-kera-node-token")?.trim() || "";
    if (!nodeId || !nodeToken) {
      return jsonError("Node credentials are required.", 401);
    }
    const bootstrap = await buildBootstrapForNode(nodeId, nodeToken);
    return Response.json(bootstrap);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Bootstrap failed.";
    return jsonError(message, 401);
  }
}

