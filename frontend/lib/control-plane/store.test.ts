import { beforeEach, describe, expect, it, vi } from "vitest";

const controlPlaneSql = vi.hoisted(() => vi.fn());

vi.mock("./db", () => ({
  controlPlaneSql,
}));

vi.mock("./config", () => ({
  controlPlaneAdminEmails: vi.fn(() => []),
  controlPlaneLlmApiKey: vi.fn(() => ""),
}));

vi.mock("./crypto", () => ({
  hashNodeToken: vi.fn(() => "hashed"),
  makeControlPlaneId: vi.fn(() => "generated_id"),
  makeNodeToken: vi.fn(() => "node_token"),
  normalizeEmail: (value: string) => value.trim().toLowerCase(),
  normalizeSiteId: (value: string) => value.trim(),
}));

vi.mock("../site-labels", () => ({
  getSiteAlias: vi.fn(() => null),
  getSiteOfficialName: vi.fn((site: { hospital_name?: string; display_name?: string }, siteId: string) => {
    return site.hospital_name || site.display_name || siteId;
  }),
}));

import { buildRetrievalCorpusUmapPayload } from "./store";

describe("buildRetrievalCorpusUmapPayload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns corpus counts without loading embeddings in metadata-only mode", async () => {
    const sql = vi
      .fn()
      .mockResolvedValueOnce([
        {
          profile_id: "dinov2_lesion_crop",
          retrieval_signature: "sig_123",
          metadata_json: {},
          created_at: "2026-04-20T00:00:00Z",
          updated_at: "2026-04-20T00:00:00Z",
        },
      ])
      .mockResolvedValueOnce([
        {
          entry_count: 24,
          site_count: 3,
          corpus_updated_at: "2026-04-20T10:00:00Z",
        },
      ]);
    controlPlaneSql.mockResolvedValue(sql);

    const payload = await buildRetrievalCorpusUmapPayload({
      profileId: "dinov2_lesion_crop",
      retrievalSignature: "sig_123",
      metadataOnly: true,
    });

    expect(payload.entries).toEqual([]);
    expect(payload.entry_count).toBe(24);
    expect(payload.site_count).toBe(3);
    expect(payload.corpus_updated_at).toBe("2026-04-20T10:00:00.000Z");
    expect(sql).toHaveBeenCalledTimes(2);
  });
});
