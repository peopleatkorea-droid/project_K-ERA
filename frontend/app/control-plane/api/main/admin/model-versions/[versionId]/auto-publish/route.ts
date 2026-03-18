import { NextRequest } from "next/server";

import { autoPublishMainModelVersion } from "../../../../../../../../lib/control-plane/main-app-bridge";
import { jsonError } from "../../../../../../../../lib/control-plane/http";

type RouteContext = {
  params: Promise<{ versionId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { versionId } = await context.params;
    const body = (await request.json()) as {
      set_current?: boolean;
    };
    return Response.json(await autoPublishMainModelVersion(request, versionId, body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to auto-publish model version.";
    return jsonError(message, 400);
  }
}
