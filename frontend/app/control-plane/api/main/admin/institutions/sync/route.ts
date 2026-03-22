import { NextRequest } from "next/server";

import { syncMainInstitutionDirectory } from "../../../../../../../lib/control-plane/main-app-bridge";
import { jsonError } from "../../../../../../../lib/control-plane/http";

export async function POST(request: NextRequest) {
  try {
    const pageSize = request.nextUrl.searchParams.get("page_size");
    const maxPages = request.nextUrl.searchParams.get("max_pages");
    return Response.json(
      await syncMainInstitutionDirectory(request, {
        page_size: pageSize ? Number(pageSize) : undefined,
        max_pages: maxPages ? Number(maxPages) : undefined,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to sync the institution directory.";
    return jsonError(message, 400);
  }
}
