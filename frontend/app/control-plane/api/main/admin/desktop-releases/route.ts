import { NextRequest } from "next/server";

import { listMainDesktopReleases, upsertMainDesktopRelease } from "../../../../../../lib/control-plane/main-app-bridge";
import { jsonError } from "../../../../../../lib/control-plane/http";

export async function GET(request: NextRequest) {
  try {
    return Response.json(await listMainDesktopReleases(request));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load desktop releases.";
    return jsonError(message, 403);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      release_id?: string;
      channel?: string;
      label?: string;
      version?: string;
      platform?: string;
      installer_type?: string;
      download_url?: string;
      folder_url?: string | null;
      sha256?: string | null;
      size_bytes?: number | null;
      notes?: string | null;
      active?: boolean;
    };
    return Response.json(await upsertMainDesktopRelease(request, body));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save desktop release.";
    return jsonError(message, 400);
  }
}
