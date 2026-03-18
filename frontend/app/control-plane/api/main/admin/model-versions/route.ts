import { NextRequest } from "next/server";

import { listMainModelVersions } from "../../../../../../lib/control-plane/main-app-bridge";
import { jsonError } from "../../../../../../lib/control-plane/http";

export async function GET(request: NextRequest) {
  try {
    return Response.json(await listMainModelVersions(request));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load model versions.";
    return jsonError(message, 403);
  }
}
