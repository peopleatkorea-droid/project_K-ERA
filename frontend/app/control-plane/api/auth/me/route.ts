import { NextRequest, NextResponse } from "next/server";

import { jsonError, requireControlPlaneUser } from "../../../../../lib/control-plane/http";

export async function GET(request: NextRequest) {
  try {
    const user = await requireControlPlaneUser(request);
    return NextResponse.json(user);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load the current user.";
    return jsonError(message, 401);
  }
}

