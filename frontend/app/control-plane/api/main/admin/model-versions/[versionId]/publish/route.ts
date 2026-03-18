import { NextRequest } from "next/server";

import { publishMainModelVersion } from "../../../../../../../../lib/control-plane/main-app-bridge";
import { jsonError } from "../../../../../../../../lib/control-plane/http";

type RouteContext = {
  params: Promise<{ versionId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { versionId } = await context.params;
    const body = (await request.json()) as {
      download_url?: string;
      set_current?: boolean;
    };
    return Response.json(await publishMainModelVersion(request, versionId, body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to publish model version.";
    return jsonError(message, 400);
  }
}
