import { NextRequest } from "next/server";

import { fetchMainUserAuth } from "../../../../../../lib/control-plane/main-app-bridge";
import { jsonError } from "../../../../../../lib/control-plane/http";

export async function GET(request: NextRequest) {
  try {
    return Response.json(await fetchMainUserAuth(request));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load the current user.";
    return jsonError(message, 401);
  }
}
