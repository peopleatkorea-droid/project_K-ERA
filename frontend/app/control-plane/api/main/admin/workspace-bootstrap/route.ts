import { NextRequest } from "next/server";

import { fetchMainAdminWorkspaceBootstrap } from "../../../../../../lib/control-plane/main-app-bridge";
import { jsonError } from "../../../../../../lib/control-plane/http";

export async function GET(request: NextRequest) {
  try {
    const siteId = request.nextUrl.searchParams.get("site_id");
    const scope = request.nextUrl.searchParams.get("scope");
    return Response.json(
      await fetchMainAdminWorkspaceBootstrap(request, {
        siteId,
        scope: scope === "initial" ? "initial" : "full",
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load admin workspace bootstrap.";
    return jsonError(message, 403);
  }
}
