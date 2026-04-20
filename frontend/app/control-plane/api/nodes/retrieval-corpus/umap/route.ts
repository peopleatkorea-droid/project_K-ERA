import { NextRequest } from "next/server";

import { jsonError, requireControlPlaneNode } from "../../../../../../lib/control-plane/http";
import { buildRetrievalCorpusUmapPayload } from "../../../../../../lib/control-plane/store";

export async function POST(request: NextRequest) {
  try {
    await requireControlPlaneNode(request);
    const body = (await request.json()) as {
      profile_id?: string;
      retrieval_signature?: string;
      metadata_only?: boolean;
    };
    const payload = await buildRetrievalCorpusUmapPayload({
      profileId: body.profile_id?.trim() || "",
      retrievalSignature: body.retrieval_signature?.trim() || "",
      metadataOnly: Boolean(body.metadata_only),
    });
    return Response.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to prepare retrieval corpus UMAP payload.";
    return jsonError(message, 401);
  }
}
