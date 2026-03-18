import { NextRequest } from "next/server";

import { jsonError, requireControlPlaneUser } from "../../../../../lib/control-plane/http";
import { registerNodeForUser } from "../../../../../lib/control-plane/store";

export async function POST(request: NextRequest) {
  try {
    const user = await requireControlPlaneUser(request);
    const body = (await request.json()) as {
      device_name?: string;
      os_info?: string;
      app_version?: string;
      site_id?: string;
      display_name?: string;
      hospital_name?: string;
      source_institution_id?: string;
    };
    const registration = await registerNodeForUser({
      user,
      deviceName: body.device_name?.trim() || "local-node",
      osInfo: body.os_info?.trim() || "",
      appVersion: body.app_version?.trim() || "",
      siteId: body.site_id?.trim() || null,
      displayName: body.display_name?.trim() || null,
      hospitalName: body.hospital_name?.trim() || null,
      sourceInstitutionId: body.source_institution_id?.trim() || null,
    });
    return Response.json({
      node_id: registration.node.node_id,
      node_token: registration.nodeToken,
      bootstrap: registration.bootstrap,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Node registration failed.";
    return jsonError(message, 400);
  }
}

