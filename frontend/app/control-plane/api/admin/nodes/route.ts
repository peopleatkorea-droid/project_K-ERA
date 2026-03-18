import { NextRequest } from "next/server";

import { jsonError, requireControlPlaneUser } from "../../../../../lib/control-plane/http";
import { assertAdminUser, listRegisteredNodes } from "../../../../../lib/control-plane/store";

export async function GET(request: NextRequest) {
  try {
    const user = await requireControlPlaneUser(request);
    await assertAdminUser(user.user_id);
    return Response.json(await listRegisteredNodes());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load nodes.";
    return jsonError(message, 403);
  }
}
