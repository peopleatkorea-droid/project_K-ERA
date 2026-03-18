import { NextRequest } from "next/server";

import { jsonError, requireControlPlaneUser } from "../../../../../lib/control-plane/http";
import { assertAdminUser, createAggregation, listAggregations } from "../../../../../lib/control-plane/store";

export async function GET(request: NextRequest) {
  try {
    const user = await requireControlPlaneUser(request);
    await assertAdminUser(user.user_id);
    return Response.json(await listAggregations());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load aggregations.";
    return jsonError(message, 403);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireControlPlaneUser(request);
    await assertAdminUser(user.user_id);
    const body = (await request.json()) as {
      base_model_version_id?: string;
      summary_json?: Record<string, unknown>;
      status?: "queued" | "running";
    };
    const aggregation = await createAggregation({
      actorUserId: user.user_id,
      baseModelVersionId: body.base_model_version_id?.trim() || null,
      summaryJson: body.summary_json || {},
      status: body.status === "running" ? "running" : "queued",
    });
    return Response.json(aggregation);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create the aggregation.";
    return jsonError(message, 403);
  }
}
