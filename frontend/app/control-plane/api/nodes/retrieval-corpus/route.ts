import { NextRequest } from "next/server";

import { jsonError, requireControlPlaneNode } from "../../../../../lib/control-plane/http";
import { createRetrievalCorpusEntriesFromNode } from "../../../../../lib/control-plane/store";

export async function POST(request: NextRequest) {
  try {
    const node = await requireControlPlaneNode(request);
    const body = (await request.json()) as {
      profile_id?: string;
      retrieval_signature?: string;
      profile_metadata_json?: Record<string, unknown>;
      replace_site_profile_scope?: boolean;
      entries?: Array<{
        entry_id?: string;
        case_reference_id?: string;
        culture_category?: string;
        culture_species?: string;
        embedding?: unknown;
        thumbnail_url?: string | null;
        metadata_json?: Record<string, unknown>;
      }>;
    };
    const result = await createRetrievalCorpusEntriesFromNode({
      nodeId: node.node_id,
      profileId: body.profile_id?.trim() || "",
      retrievalSignature: body.retrieval_signature?.trim() || "",
      profileMetadataJson: body.profile_metadata_json || {},
      replaceSiteProfileScope: Boolean(body.replace_site_profile_scope),
      entries: body.entries || [],
    });
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to upload retrieval corpus entries.";
    return jsonError(message, 401);
  }
}
