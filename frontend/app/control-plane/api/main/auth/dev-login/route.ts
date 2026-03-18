import { NextRequest } from "next/server";

import { devLoginMain } from "../../../../../../lib/control-plane/main-app-bridge";
import { jsonError } from "../../../../../../lib/control-plane/http";

export async function POST(request: NextRequest) {
  try {
    return Response.json(await devLoginMain(request));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to sign in with local dev admin.";
    return jsonError(message, 400);
  }
}
