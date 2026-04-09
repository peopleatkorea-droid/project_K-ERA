import { NextRequest } from "next/server";

import { jsonError, requireControlPlaneNode } from "../../../../../lib/control-plane/http";
import { currentReleaseManifestForSite } from "../../../../../lib/control-plane/store";

export async function GET(request: NextRequest) {
  try {
    const node = await requireControlPlaneNode(request);
    return Response.json(await currentReleaseManifestForSite(node.site_id));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load the current release.";
    return jsonError(message, 401);
  }
}
