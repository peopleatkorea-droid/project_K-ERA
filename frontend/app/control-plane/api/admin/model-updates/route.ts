import { NextRequest } from "next/server";

import { jsonError, requireControlPlaneUser } from "../../../../../lib/control-plane/http";
import { assertAdminUser, listModelUpdates } from "../../../../../lib/control-plane/store";

export async function GET(request: NextRequest) {
  try {
    const user = await requireControlPlaneUser(request);
    await assertAdminUser(user.user_id);
    return Response.json(await listModelUpdates());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load model updates.";
    return jsonError(message, 403);
  }
}
