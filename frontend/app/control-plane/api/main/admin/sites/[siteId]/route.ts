import { NextRequest } from "next/server";

import { updateMainAdminSite } from "../../../../../../../lib/control-plane/main-app-bridge";
import { jsonError } from "../../../../../../../lib/control-plane/http";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ siteId: string }> },
) {
  try {
    const { siteId } = await context.params;
    const body = (await request.json()) as {
      display_name?: string;
      hospital_name?: string;
      research_registry_enabled?: boolean;
    };
    return Response.json(await updateMainAdminSite(request, siteId, body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update the site.";
    return jsonError(message, 400);
  }
}
