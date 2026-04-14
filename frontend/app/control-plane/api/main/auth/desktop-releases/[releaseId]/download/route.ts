import { NextRequest } from "next/server";

import { claimMainDesktopReleaseDownload } from "../../../../../../../../lib/control-plane/main-app-bridge";
import { authJsonResponse, jsonError } from "../../../../../../../../lib/control-plane/http";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ releaseId: string }> },
) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      site_id?: string | null;
    };
    const { releaseId } = await context.params;
    return authJsonResponse(await claimMainDesktopReleaseDownload(request, releaseId, body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to prepare the desktop download.";
    return jsonError(message, 400);
  }
}
