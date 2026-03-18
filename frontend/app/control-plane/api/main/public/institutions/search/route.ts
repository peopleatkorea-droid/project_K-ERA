import { NextRequest } from "next/server";

import { searchPublicInstitutions } from "../../../../../../../lib/control-plane/main-app-bridge";
import { jsonError } from "../../../../../../../lib/control-plane/http";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const query = searchParams.get("q") || "";
    const sidoCode = searchParams.get("sido_code") || undefined;
    const sgguCode = searchParams.get("sggu_code") || undefined;
    const limit = Number(searchParams.get("limit") || "12");
    return Response.json(
      await searchPublicInstitutions(request, query, {
        sido_code: sidoCode,
        sggu_code: sgguCode,
        limit: Number.isFinite(limit) ? limit : 12,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to search institutions.";
    return jsonError(message, 400);
  }
}
