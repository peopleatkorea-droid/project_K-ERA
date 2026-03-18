import { NextRequest } from "next/server";

import { jsonError, requireControlPlaneUser } from "../../../../../../../lib/control-plane/http";
import { assertAdminUser, completeAggregation } from "../../../../../../../lib/control-plane/store";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ aggregationId: string }> },
) {
  try {
    const user = await requireControlPlaneUser(request);
    await assertAdminUser(user.user_id);
    const { aggregationId } = await context.params;
    const body = (await request.json()) as {
      status?: "completed" | "failed";
      new_version_id?: string;
      summary_json?: Record<string, unknown>;
    };
    if (body.status !== "completed" && body.status !== "failed") {
      return jsonError("status must be completed or failed.");
    }
    const aggregation = await completeAggregation({
      aggregationId,
      actorUserId: user.user_id,
      status: body.status,
      newVersionId: body.new_version_id?.trim() || null,
      summaryJson: body.summary_json || {},
    });
    return Response.json(aggregation);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to complete the aggregation.";
    return jsonError(message, 403);
  }
}
