import { NextRequest } from "next/server";

import { fetchMainInstitutionDirectoryStatus } from "../../../../../../../lib/control-plane/main-app-bridge";
import { jsonError } from "../../../../../../../lib/control-plane/http";

export async function GET(request: NextRequest) {
  try {
    return Response.json(await fetchMainInstitutionDirectoryStatus(request));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load institution directory status.";
    return jsonError(message, 403);
  }
}
