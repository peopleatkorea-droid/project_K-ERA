import { NextRequest } from "next/server";

import { listMainUsers, upsertMainUser } from "../../../../../../lib/control-plane/main-app-bridge";
import { jsonError } from "../../../../../../lib/control-plane/http";

export async function GET(request: NextRequest) {
  try {
    return Response.json(await listMainUsers(request));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load users.";
    return jsonError(message, 403);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      user_id?: string;
      username?: string;
      full_name?: string;
      password?: string;
      role?: string;
      site_ids?: string[];
    };
    return Response.json(await upsertMainUser(request, body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save user.";
    return jsonError(message, 400);
  }
}
