import { NextRequest } from "next/server";

import { jsonError, requireControlPlaneNode } from "../../../../../lib/control-plane/http";
import { createModelUpdateFromNode } from "../../../../../lib/control-plane/store";

export async function POST(request: NextRequest) {
  try {
    const node = await requireControlPlaneNode(request);
    const body = (await request.json()) as {
      base_model_version_id?: string;
      payload_json?: Record<string, unknown>;
      review_thumbnail_url?: string;
    };
    const update = await createModelUpdateFromNode({
      nodeId: node.node_id,
      baseModelVersionId: body.base_model_version_id?.trim() || null,
      payloadJson: body.payload_json || {},
      reviewThumbnailUrl: body.review_thumbnail_url?.trim() || null,
    });
    return Response.json(update);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to upload the model update.";
    return jsonError(message, 401);
  }
}
