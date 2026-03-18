import { NextRequest } from "next/server";

import { jsonError, requireControlPlaneUser } from "../../../../../lib/control-plane/http";
import { assertAdminUser, listModelVersions, publishModelVersion } from "../../../../../lib/control-plane/store";

export async function GET(request: NextRequest) {
  try {
    const user = await requireControlPlaneUser(request);
    await assertAdminUser(user.user_id);
    return Response.json(await listModelVersions());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load model versions.";
    return jsonError(message, 403);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireControlPlaneUser(request);
    await assertAdminUser(user.user_id);
    const body = (await request.json()) as {
      version_id?: string;
      version_name?: string;
      architecture?: string;
      source_provider?: string;
      download_url?: string;
      sha256?: string;
      size_bytes?: number;
      ready?: boolean;
      is_current?: boolean;
      metadata_json?: Record<string, unknown>;
    };
    if (!body.version_name?.trim() || !body.architecture?.trim() || !body.download_url?.trim()) {
      return jsonError("version_name, architecture, and download_url are required.");
    }
    const version = await publishModelVersion({
      actorUserId: user.user_id,
      versionId: body.version_id?.trim(),
      versionName: body.version_name,
      architecture: body.architecture,
      sourceProvider: body.source_provider,
      downloadUrl: body.download_url,
      sha256: body.sha256?.trim() || "",
      sizeBytes: Number(body.size_bytes || 0),
      ready: body.ready ?? true,
      isCurrent: body.is_current ?? true,
      metadataJson: body.metadata_json || {},
    });
    return Response.json(version);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to publish model version.";
    return jsonError(message, 403);
  }
}
