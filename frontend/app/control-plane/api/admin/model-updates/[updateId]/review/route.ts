import { NextRequest } from "next/server";

import { jsonError, requireControlPlaneUser } from "../../../../../../../lib/control-plane/http";
import { assertAdminUser, reviewModelUpdate } from "../../../../../../../lib/control-plane/store";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ updateId: string }> },
) {
  try {
    const user = await requireControlPlaneUser(request);
    await assertAdminUser(user.user_id);
    const { updateId } = await context.params;
    const body = (await request.json()) as {
      decision?: "approved" | "rejected";
      reviewer_notes?: string;
    };
    if (body.decision !== "approved" && body.decision !== "rejected") {
      return jsonError("decision must be approved or rejected.");
    }
    const update = await reviewModelUpdate({
      updateId,
      reviewerUserId: user.user_id,
      decision: body.decision,
      reviewerNotes: body.reviewer_notes?.trim() || "",
    });
    return Response.json(update);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to review the model update.";
    return jsonError(message, 403);
  }
}
