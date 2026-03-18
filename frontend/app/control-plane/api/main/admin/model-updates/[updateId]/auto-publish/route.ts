import { NextRequest } from "next/server";

import { autoPublishMainModelUpdate } from "../../../../../../../../lib/control-plane/main-app-bridge";
import { jsonError } from "../../../../../../../../lib/control-plane/http";

type RouteContext = {
  params: Promise<{ updateId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { updateId } = await context.params;
    return Response.json(await autoPublishMainModelUpdate(request, updateId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to auto-publish model update.";
    return jsonError(message, 400);
  }
}
