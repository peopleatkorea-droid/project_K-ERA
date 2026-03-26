import { NextRequest } from "next/server";

import { createMainAdminSite, listMainAdminSites } from "../../../../../../lib/control-plane/main-app-bridge";
import { jsonError } from "../../../../../../lib/control-plane/http";

export async function GET(request: NextRequest) {
  try {
    const projectId = request.nextUrl.searchParams.get("project_id");
    return Response.json(await listMainAdminSites(request, projectId));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load sites.";
    return jsonError(message, 403);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      project_id?: string;
      hospital_name?: string;
      source_institution_id?: string | null;
      research_registry_enabled?: boolean;
    };
    return Response.json(await createMainAdminSite(request, body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create the site.";
    return jsonError(message, 400);
  }
}
