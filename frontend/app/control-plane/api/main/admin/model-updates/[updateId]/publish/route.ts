import { NextRequest } from "next/server";

import { publishMainModelUpdate } from "../../../../../../../../lib/control-plane/main-app-bridge";
import { jsonError } from "../../../../../../../../lib/control-plane/http";

type RouteContext = {
  params: Promise<{ updateId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { updateId } = await context.params;
    const body = (await request.json()) as {
      download_url?: string;
    };
    return Response.json(await publishMainModelUpdate(request, updateId, body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to publish model update.";
    return jsonError(message, 400);
  }
}
