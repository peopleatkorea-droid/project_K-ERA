import { NextRequest } from "next/server";

import { enrollMainResearchRegistry } from "../../../../../../../../lib/control-plane/main-app-bridge";
import { authJsonResponse, jsonError } from "../../../../../../../../lib/control-plane/http";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ siteId: string }> },
) {
  try {
    const { siteId } = await context.params;
    const body = (await request.json()) as { version?: string };
    return authJsonResponse(await enrollMainResearchRegistry(request, siteId, body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to join the research registry.";
    return jsonError(message, 400);
  }
}
