import { NextRequest } from "next/server";

import { submitMainAccessRequest } from "../../../../../../lib/control-plane/main-app-bridge";
import { authJsonResponse, jsonError } from "../../../../../../lib/control-plane/http";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      requested_site_id?: string;
      requested_site_label?: string;
      requested_role?: string;
      message?: string;
    };
    return authJsonResponse(await submitMainAccessRequest(request, body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to submit the access request.";
    return jsonError(message, 400);
  }
}
