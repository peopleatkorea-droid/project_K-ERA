import { NextRequest } from "next/server";

import { activateMainDesktopRelease } from "../../../../../../../../lib/control-plane/main-app-bridge";
import { jsonError } from "../../../../../../../../lib/control-plane/http";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ releaseId: string }> },
) {
  try {
    const { releaseId } = await context.params;
    return Response.json(await activateMainDesktopRelease(request, releaseId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to activate desktop release.";
    return jsonError(message, 400);
  }
}
