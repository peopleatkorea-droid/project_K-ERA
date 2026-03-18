import { NextRequest } from "next/server";

import { createMainProject, listMainProjects } from "../../../../../../lib/control-plane/main-app-bridge";
import { jsonError } from "../../../../../../lib/control-plane/http";

export async function GET(request: NextRequest) {
  try {
    return Response.json(await listMainProjects(request));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load projects.";
    return jsonError(message, 403);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { name?: string; description?: string };
    return Response.json(await createMainProject(request, body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create the project.";
    return jsonError(message, 400);
  }
}
