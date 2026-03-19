import { beforeEach, describe, expect, it, vi } from "vitest";

const requireMainAppBridgeUser = vi.hoisted(() => vi.fn());
const controlPlaneSql = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));

vi.mock("./crypto", () => ({
  makeControlPlaneId: vi.fn(() => "id_test"),
}));

vi.mock("./config", () => ({
  controlPlaneDevAuthEnabled: vi.fn(() => true),
}));

vi.mock("./db", () => ({
  controlPlaneSql,
}));

vi.mock("./google", () => ({
  verifyGoogleIdentityToken: vi.fn(),
}));

vi.mock("./main-app-bridge-admin", () => ({
  createMainAdminSite: vi.fn(),
  createMainProject: vi.fn(),
  fetchMainAdminOverview: vi.fn(),
  fetchMainInstitutionDirectoryStatus: vi.fn(),
  listMainAdminAccessRequests: vi.fn(),
  listMainAdminSites: vi.fn(),
  listMainProjects: vi.fn(),
  listMainUsers: vi.fn(),
  reviewMainAccessRequest: vi.fn(),
  updateMainAdminSite: vi.fn(),
  upsertMainUser: vi.fn(),
}));

vi.mock("./main-app-bridge-models", () => ({
  autoPublishMainModelUpdate: vi.fn(),
  autoPublishMainModelVersion: vi.fn(),
  deleteMainModelVersion: vi.fn(),
  listMainAggregations: vi.fn(),
  listMainModelUpdates: vi.fn(),
  listMainModelVersions: vi.fn(),
  publishMainModelUpdate: vi.fn(),
  publishMainModelVersion: vi.fn(),
  reviewMainModelUpdate: vi.fn(),
  runMainFederatedAggregation: vi.fn(),
}));

vi.mock("./main-app-bridge-public", () => ({
  fetchPublicStatistics: vi.fn(),
  listPublicSites: vi.fn(),
  searchPublicInstitutions: vi.fn(),
}));

vi.mock("./main-app-bridge-records", () => ({
  ensureDefaultProject: vi.fn(),
  institutionRowById: vi.fn(),
  latestAccessRequestForCanonicalUser: vi.fn(),
  listAccessRequestsForCanonicalUser: vi.fn(),
  serializeSiteRecord: (row: Record<string, unknown>) => ({
    site_id: row.site_id,
    display_name: row.display_name,
    hospital_name: row.hospital_name,
  }),
  siteRowById: vi.fn(),
  siteRowBySourceInstitutionId: vi.fn(),
  upsertAccessRequestRecord: vi.fn(),
}));

vi.mock("./main-app-bridge-users", () => ({
  authenticateMainAppUser: vi.fn(),
  buildLegacyAuthUser: vi.fn(),
  buildMainAuthResponse: vi.fn(),
  canonicalUserRowById: vi.fn(),
  requireMainAppBridgeUser,
}));

vi.mock("./main-app-bridge-shared", () => ({
  fetchLegacyLocalNodeApi: vi.fn(),
  legacyEmailForLocalUser: vi.fn(),
  normalizeRegistryConsents: (value: unknown) => value ?? {},
  normalizeStringArray: (value: unknown) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [],
  readBearerToken: vi.fn(),
  rowValue: (row: Record<string, unknown>, key: string) => row[key],
  trimText: (value: unknown) => (typeof value === "string" ? value.trim() : ""),
}));

vi.mock("./store", () => ({
  ensureControlPlaneIdentity: vi.fn(),
}));

import { fetchSitesForMainUser } from "./main-app-bridge";

describe("fetchSitesForMainUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns all sites for a global admin even when site_ids is empty", async () => {
    const sql = vi.fn().mockResolvedValue([
      {
        site_id: "39100103",
        display_name: "JNUH",
        hospital_name: "Jeju University Hospital",
      },
      {
        site_id: "smoke-site",
        display_name: "Smoke Site",
        hospital_name: "Smoke Hospital",
      },
    ]);
    requireMainAppBridgeUser.mockResolvedValue({
      user: {
        role: "admin",
        site_ids: [],
      },
    });
    controlPlaneSql.mockResolvedValue(sql);

    const result = await fetchSitesForMainUser({} as never);

    expect(controlPlaneSql).toHaveBeenCalledTimes(1);
    expect(sql).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      {
        site_id: "39100103",
        display_name: "JNUH",
        hospital_name: "Jeju University Hospital",
      },
      {
        site_id: "smoke-site",
        display_name: "Smoke Site",
        hospital_name: "Smoke Hospital",
      },
    ]);
  });

  it("returns an empty site list for non-admin users without approved sites", async () => {
    requireMainAppBridgeUser.mockResolvedValue({
      user: {
        role: "site_admin",
        site_ids: [],
      },
    });

    const result = await fetchSitesForMainUser({} as never);

    expect(controlPlaneSql).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });
});
