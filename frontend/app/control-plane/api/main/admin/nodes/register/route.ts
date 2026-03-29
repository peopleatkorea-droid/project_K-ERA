import { NextRequest } from "next/server";

import { jsonError } from "../../../../../../../lib/control-plane/http";
import { requireMainAppBridgeUser } from "../../../../../../../lib/control-plane/main-app-bridge-users";
import { registerNodeForUser } from "../../../../../../../lib/control-plane/store";

export async function POST(request: NextRequest) {
  try {
    const { canonicalUser, user } = await requireMainAppBridgeUser(request);
    if (user.role !== "admin" && user.role !== "site_admin") {
      return jsonError("Admin or site admin access required.", 403);
    }
    if (!canonicalUser) {
      return jsonError("Authentication required.", 401);
    }
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
      user: canonicalUser,
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
