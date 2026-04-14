import { beforeEach, describe, expect, it, vi } from "vitest";

const controlPlaneSql = vi.hoisted(() => vi.fn());
const upsertInstitutionRecord = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));

vi.mock("./config", () => ({
  controlPlaneHiraApiKey: vi.fn(() => "test-hira-key"),
  controlPlaneHiraApiTimeoutMs: vi.fn(() => 5_000),
  controlPlaneHiraHospitalInfoUrl: vi.fn(() => "https://example.test/hira"),
}));

vi.mock("./db", () => ({
  controlPlaneSql,
}));

vi.mock("./main-app-bridge-records", () => ({
  ensureDefaultProject: vi.fn(),
  serializeInstitutionRecord: (row: Record<string, unknown>) => row,
  serializeSiteRecord: (row: Record<string, unknown>) => row,
  upsertInstitutionRecord,
}));

vi.mock("./main-app-bridge-shared", () => ({
  trimText: (value: unknown) => (typeof value === "string" ? value.trim() : ""),
}));

import { searchPublicInstitutions } from "./main-app-bridge-public";

describe("searchPublicInstitutions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("returns local institution directory matches without live HIRA fallback", async () => {
    const unsafe = vi.fn().mockResolvedValue([
      {
        institution_id: "39100103",
        source: "hira",
        name: "제주대학교병원",
        institution_type_code: "11",
        institution_type_name: "종합병원",
        address: "제주특별자치도 제주시",
        phone: "064-717-1114",
        homepage: "",
        sido_code: "390000",
        sggu_code: "390200",
        emdong_name: "아라일동",
        postal_code: "63241",
        x_pos: "",
        y_pos: "",
        ophthalmology_available: true,
        open_status: "active",
        synced_at: "2026-04-14T00:00:00Z",
      },
    ]);
    controlPlaneSql.mockResolvedValue({ unsafe });

    const result = await searchPublicInstitutions({} as never, "제주대", { limit: 8 });

    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("제주대학교병원");
    expect(fetch).not.toHaveBeenCalled();
    expect(upsertInstitutionRecord).not.toHaveBeenCalled();
  });

  it("falls back to live HIRA search when the synced directory has no match", async () => {
    const unsafe = vi.fn().mockResolvedValue([]);
    controlPlaneSql.mockResolvedValue({ unsafe });
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({
        response: {
          header: { resultCode: "00", resultMsg: "NORMAL SERVICE." },
          body: {
            items: {
              item: {
                ykiho: "39100103",
                yadmNm: "제주대학교병원",
                clCd: "11",
                clCdNm: "종합병원",
                addr: "제주특별자치도 제주시 아란13길 15",
                telno: "064-717-1114",
                sidoCd: "390000",
                sgguCd: "390200",
                emdongNm: "아라일동",
                postNo: "63241",
              },
            },
          },
        },
      }),
    } as Response);

    const result = await searchPublicInstitutions({} as never, "제주대", { limit: 8 });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe("제주대학교병원");
    expect(upsertInstitutionRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        institution_id: "39100103",
        name: "제주대학교병원",
        source: "hira",
      }),
    );
  });
});
