import { NextRequest } from "next/server";

import { jsonError, requireControlPlaneUser } from "../../../../../lib/control-plane/http";
import { assertAdminUser, listValidationRuns } from "../../../../../lib/control-plane/store";

export async function GET(request: NextRequest) {
  try {
    const user = await requireControlPlaneUser(request);
    await assertAdminUser(user.user_id);
    return Response.json(await listValidationRuns());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load validation runs.";
    return jsonError(message, 403);
  }
}
