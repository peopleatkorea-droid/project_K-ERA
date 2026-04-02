import { NextRequest } from "next/server";

import { controlPlaneDevAuthEnabled, controlPlaneSandboxEnabled } from "../../../../../lib/control-plane/config";
import { jsonError, sessionResponse } from "../../../../../lib/control-plane/http";
import { ensureControlPlaneIdentity, setControlPlaneUserGlobalRole } from "../../../../../lib/control-plane/store";

export async function POST(request: NextRequest) {
  if (!controlPlaneSandboxEnabled()) {
    return jsonError("Legacy control-plane sandbox is disabled.", 404);
  }
  if (!controlPlaneDevAuthEnabled()) {
    return jsonError("Development auth is disabled.", 403);
  }

  try {
    const body = (await request.json()) as {
      email?: string;
      full_name?: string;
      make_admin?: boolean;
    };
    const email = body.email?.trim().toLowerCase() || "";
    if (!email) {
      return jsonError("email is required.");
    }
    let user = await ensureControlPlaneIdentity({
      email,
      fullName: body.full_name?.trim() || email.split("@")[0],
      googleSub: null,
    });
    if (body.make_admin) {
      user = await setControlPlaneUserGlobalRole(user.user_id, "admin");
    }
    return sessionResponse(user.user_id, { user });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Development login failed.";
    return jsonError(message, 400);
  }
}
