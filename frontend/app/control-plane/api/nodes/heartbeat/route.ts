import { NextRequest } from "next/server";

import { jsonError, requireControlPlaneNode } from "../../../../../lib/control-plane/http";
import { recordNodeHeartbeat } from "../../../../../lib/control-plane/store";

export async function POST(request: NextRequest) {
  try {
    const node = await requireControlPlaneNode(request);
    const body = (await request.json()) as {
      app_version?: string;
      os_info?: string;
      status?: string;
    };
    const refreshed = await recordNodeHeartbeat(node.node_id, {
      appVersion: body.app_version?.trim() || "",
      osInfo: body.os_info?.trim() || "",
      status: body.status?.trim() || "ok",
    });
    return Response.json(refreshed);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Heartbeat failed.";
    return jsonError(message, 401);
  }
}

