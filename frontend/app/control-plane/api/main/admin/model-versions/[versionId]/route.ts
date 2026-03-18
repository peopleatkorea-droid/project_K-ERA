import { NextRequest } from "next/server";

import { deleteMainModelVersion } from "../../../../../../../lib/control-plane/main-app-bridge";
import { jsonError } from "../../../../../../../lib/control-plane/http";

type RouteContext = {
  params: Promise<{ versionId: string }>;
};

export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const { versionId } = await context.params;
    return Response.json(await deleteMainModelVersion(request, versionId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to delete model version.";
    return jsonError(message, 400);
  }
}
