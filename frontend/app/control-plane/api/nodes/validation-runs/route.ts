import { NextRequest } from "next/server";

import { jsonError, requireControlPlaneNode } from "../../../../../lib/control-plane/http";
import { createValidationRunFromNode } from "../../../../../lib/control-plane/store";

export async function POST(request: NextRequest) {
  try {
    const node = await requireControlPlaneNode(request);
    const body = (await request.json()) as {
      summary_json?: Record<string, unknown>;
    };
    const validationRun = await createValidationRunFromNode({
      nodeId: node.node_id,
      summaryJson: body.summary_json || {},
    });
    return Response.json(validationRun);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to upload the validation summary.";
    return jsonError(message, 401);
  }
}
