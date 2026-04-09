import { NextRequest } from "next/server";

import { jsonError, requireControlPlaneNode } from "../../../../../../lib/control-plane/http";
import { searchRetrievalCorpusEntries } from "../../../../../../lib/control-plane/store";

export async function POST(request: NextRequest) {
  try {
    await requireControlPlaneNode(request);
    const body = (await request.json()) as {
      profile_id?: string;
      retrieval_signature?: string;
      query_embedding?: unknown;
      top_k?: number;
      exclude_site_id?: string | null;
      exclude_case_reference_id?: string | null;
    };
    const hits = await searchRetrievalCorpusEntries({
      profileId: body.profile_id?.trim() || "",
      retrievalSignature: body.retrieval_signature?.trim() || "",
      queryEmbedding: body.query_embedding || [],
      topK: body.top_k,
      excludeSiteId: body.exclude_site_id?.trim() || null,
      excludeCaseReferenceId: body.exclude_case_reference_id?.trim() || null,
    });
    return Response.json(hits);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to search the retrieval corpus.";
    return jsonError(message, 401);
  }
}
