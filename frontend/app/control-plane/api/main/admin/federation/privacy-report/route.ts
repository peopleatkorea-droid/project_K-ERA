import { NextRequest } from "next/server";

import { fetchMainFederatedPrivacyReport } from "../../../../../../../lib/control-plane/main-app-bridge";
import { jsonError } from "../../../../../../../lib/control-plane/http";

export async function GET(request: NextRequest) {
  try {
    return Response.json(await fetchMainFederatedPrivacyReport(request));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to export the federated privacy report.";
    return jsonError(message, 400);
  }
}
