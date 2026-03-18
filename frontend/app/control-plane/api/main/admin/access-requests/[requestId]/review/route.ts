import { NextRequest } from "next/server";

import { reviewMainAccessRequest } from "../../../../../../../../lib/control-plane/main-app-bridge";
import { jsonError } from "../../../../../../../../lib/control-plane/http";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ requestId: string }> },
) {
  try {
    const { requestId } = await context.params;
    const body = (await request.json()) as {
      decision?: "approved" | "rejected";
      assigned_role?: string;
      assigned_site_id?: string;
      create_site_if_missing?: boolean;
      project_id?: string;
      site_code?: string;
      display_name?: string;
      hospital_name?: string;
      research_registry_enabled?: boolean;
      reviewer_notes?: string;
    };
    return Response.json(await reviewMainAccessRequest(request, requestId, body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to review the access request.";
    return jsonError(message, 400);
  }
}
