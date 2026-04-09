import { NextRequest } from "next/server";

import { createMainReleaseRollout, listMainReleaseRollouts } from "../../../../../../lib/control-plane/main-app-bridge";
import { jsonError } from "../../../../../../lib/control-plane/http";

export async function GET(request: NextRequest) {
  try {
    return Response.json(await listMainReleaseRollouts(request));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load release rollouts.";
    return jsonError(message, 400);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      version_id?: string;
      stage?: "pilot" | "partial" | "full" | "rollback";
      target_site_ids?: string[];
      notes?: string;
    };
    return Response.json(await createMainReleaseRollout(request, body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create the release rollout.";
    return jsonError(message, 400);
  }
}
