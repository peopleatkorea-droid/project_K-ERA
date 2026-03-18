import { NextRequest } from "next/server";

import { reviewMainModelUpdate } from "../../../../../../../../lib/control-plane/main-app-bridge";
import { jsonError } from "../../../../../../../../lib/control-plane/http";

type RouteContext = {
  params: Promise<{ updateId: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { updateId } = await context.params;
    const body = (await request.json()) as {
      decision?: "approved" | "rejected";
      reviewer_notes?: string;
    };
    return Response.json(await reviewMainModelUpdate(request, updateId, body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to review model update.";
    return jsonError(message, 400);
  }
}
