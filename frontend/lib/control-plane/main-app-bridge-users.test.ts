import { beforeEach, describe, expect, it, vi } from "vitest";

const controlPlaneSql = vi.hoisted(() => vi.fn());
const getControlPlaneUser = vi.hoisted(() => vi.fn());
const latestAccessRequestForCanonicalUser = vi.hoisted(() => vi.fn());
const latestApprovedAccessRequestForCanonicalUser = vi.hoisted(() => vi.fn());
const siteRowById = vi.hoisted(() => vi.fn());
const siteRowBySourceInstitutionId = vi.hoisted(() => vi.fn());

vi.mock("server-only", () => ({}));

vi.mock("./crypto", () => ({
  makeControlPlaneId: vi.fn(() => "generated_id"),
  normalizeEmail: (value: string) => value.trim().toLowerCase(),
}));

vi.mock("./db", () => ({
  controlPlaneSql,
}));

vi.mock("./main-app-bridge-records", () => ({
  latestAccessRequestForCanonicalUser,
  latestApprovedAccessRequestForCanonicalUser,
  preloadAccessRequestLookups: vi.fn(),
  serializeAccessRequestRecordWithLookups: vi.fn(),
  siteRowById,
  siteRowBySourceInstitutionId,
  upsertAccessRequestRecord: vi.fn(),
  upsertSiteRecord: vi.fn(),
}));

vi.mock("./main-app-bridge-shared", () => ({
  buildLocalAuthResponse: vi.fn(),
  DEFAULT_PROJECT_ID: "DEFAULT_PROJECT_ID",
  legacyEmailForLocalUser: vi.fn(),
  MainAppTokenClaims: {},
  mapLegacyRoleToMembershipRole: vi.fn(() => "member"),
  normalizeRegistryConsents: (value: unknown) =>
    value && typeof value === "object" ? (value as Record<string, unknown>) : {},
  normalizeSiteIdPreservingCase: (value: unknown) => (typeof value === "string" ? value.trim() : ""),
  normalizeStringArray: (value: unknown) =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
      : [],
  readMainAppTokenClaims: vi.fn(),
  rowValue: (row: Record<string, unknown>, key: string) => row[key],
  trimText: (value: unknown) => (typeof value === "string" ? value.trim() : ""),
}));

vi.mock("./passwords", () => ({
  verifyControlPlanePassword: vi.fn(() => true),
}));

vi.mock("../site-labels", () => ({
  getSiteAlias: vi.fn(() => null),
  getSiteOfficialName: vi.fn((site: { hospital_name?: string; display_name?: string }, siteId: string) => {
    return site.hospital_name || site.display_name || siteId;
  }),
}));

vi.mock("./store", () => ({
  getControlPlaneUser,
}));

import { buildMainAuthUser } from "./main-app-bridge-users";

describe("buildMainAuthUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("treats legacy site_ids as approved access when canonical memberships are missing", async () => {
    const sql = vi.fn().mockResolvedValue([
      {
        user_id: "user_1",
        username: "researcher",
        public_alias: null,
        full_name: "Researcher",
        role: "researcher",
        site_ids: ["SITE_A"],
        registry_consents: {},
      },
    ]);
    controlPlaneSql.mockResolvedValue(sql);
    getControlPlaneUser.mockResolvedValue({
      user_id: "user_1",
      email: "researcher@example.com",
      full_name: "Researcher",
      google_sub: "google_sub_1",
      global_role: "member",
      status: "active",
      created_at: "2026-04-14T00:00:00Z",
      memberships: [],
    });
    siteRowById.mockImplementation(async (siteId: string) =>
      siteId === "SITE_A" ? { site_id: "SITE_A", display_name: "Site A", hospital_name: "Hospital A" } : null,
    );
    siteRowBySourceInstitutionId.mockResolvedValue(null);
    latestApprovedAccessRequestForCanonicalUser.mockResolvedValue(null);

    const user = await buildMainAuthUser("user_1");

    expect(user.site_ids).toEqual(["SITE_A"]);
    expect(user.approval_status).toBe("approved");
    expect(latestAccessRequestForCanonicalUser).not.toHaveBeenCalled();
  });

  it("treats an approved access request as approved access when canonical memberships are missing", async () => {
    const sql = vi.fn().mockResolvedValue([
      {
        user_id: "user_2",
        username: "pending_user",
        public_alias: null,
        full_name: "Pending User",
        role: "viewer",
        site_ids: [],
        registry_consents: {},
      },
    ]);
    controlPlaneSql.mockResolvedValue(sql);
    getControlPlaneUser.mockResolvedValue({
      user_id: "user_2",
      email: "pending@example.com",
      full_name: "Pending User",
      google_sub: "google_sub_2",
      global_role: "member",
      status: "active",
      created_at: "2026-04-14T00:00:00Z",
      memberships: [],
    });
    siteRowById.mockImplementation(async (siteId: string) =>
      siteId === "SITE_A" ? { site_id: "SITE_A", display_name: "Site A", hospital_name: "Hospital A" } : null,
    );
    siteRowBySourceInstitutionId.mockResolvedValue(null);
    latestApprovedAccessRequestForCanonicalUser.mockResolvedValue({
      request_id: "access_approved_1",
      user_id: "user_2",
      email: "pending@example.com",
      requested_site_id: "SITE_A",
      requested_role: "researcher",
      message: "",
      status: "approved",
      reviewed_by: null,
      reviewer_notes: "Automatically approved researcher access request.",
      created_at: "2026-04-14T00:00:00Z",
      reviewed_at: "2026-04-14T00:01:00Z",
      resolved_site_id: "SITE_A",
    });

    const user = await buildMainAuthUser("user_2");

    expect(user.site_ids).toEqual(["SITE_A"]);
    expect(user.approval_status).toBe("approved");
    expect(latestAccessRequestForCanonicalUser).not.toHaveBeenCalled();
  });

  it("treats approved site memberships as researcher access even when the membership role is viewer", async () => {
    const sql = vi.fn().mockResolvedValue([
      {
        user_id: "user_3",
        username: "viewer_user",
        public_alias: null,
        full_name: "Viewer User",
        role: "viewer",
        site_ids: ["SITE_A"],
        registry_consents: {},
      },
    ]);
    controlPlaneSql.mockResolvedValue(sql);
    getControlPlaneUser.mockResolvedValue({
      user_id: "user_3",
      email: "viewer@example.com",
      full_name: "Viewer User",
      google_sub: "google_sub_3",
      global_role: "member",
      status: "active",
      created_at: "2026-04-14T00:00:00Z",
      memberships: [
        {
          membership_id: "membership_1",
          user_id: "user_3",
          site_id: "SITE_A",
          role: "viewer",
          status: "approved",
          approved_at: "2026-04-14T00:00:00Z",
          created_at: "2026-04-14T00:00:00Z",
          updated_at: "2026-04-14T00:00:00Z",
        },
      ],
    });
    siteRowById.mockImplementation(async (siteId: string) =>
      siteId === "SITE_A" ? { site_id: "SITE_A", display_name: "Site A", hospital_name: "Hospital A" } : null,
    );
    siteRowBySourceInstitutionId.mockResolvedValue(null);
    latestApprovedAccessRequestForCanonicalUser.mockResolvedValue(null);

    const user = await buildMainAuthUser("user_3");

    expect(user.role).toBe("researcher");
    expect(user.site_ids).toEqual(["SITE_A"]);
    expect(user.approval_status).toBe("approved");
  });
});
