import { beforeEach, describe, expect, it, vi } from "vitest";

const requireMainAppBridgeUser = vi.hoisted(() => vi.fn());
const controlPlaneSql = vi.hoisted(() => vi.fn());
const buildLocalAuthResponse = vi.hoisted(() => vi.fn());
const listAccessRequestsForCanonicalUser = vi.hoisted(() => vi.fn());
const institutionRowById = vi.hoisted(() => vi.fn());
const latestAccessRequestForCanonicalUser = vi.hoisted(() => vi.fn());
const siteRowById = vi.hoisted(() => vi.fn());
const siteRowBySourceInstitutionId = vi.hoisted(() => vi.fn());
const upsertAccessRequestRecord = vi.hoisted(() => vi.fn());
const listActiveDesktopReleases = vi.hoisted(() => vi.fn());
const desktopReleaseRowById = vi.hoisted(() => vi.fn());
const appendDesktopDownloadEvent = vi.hoisted(() => vi.fn());
const buildLegacyAuthUser = vi.hoisted(() => vi.fn());
const buildMainAuthResponse = vi.hoisted(() => vi.fn());
const legacyEmailForLocalUser = vi.hoisted(() => vi.fn());
const appendAuditEvent = vi.hoisted(() => vi.fn());

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
  fetchMainAdminWorkspaceBootstrap: vi.fn(),
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
  institutionRowById,
  latestAccessRequestForCanonicalUser,
  listAccessRequestsForCanonicalUser,
  listActiveDesktopReleases,
  serializeSiteRecord: (row: Record<string, unknown>) => {
    const siteId = typeof row.site_id === "string" ? row.site_id : "";
    const sourceInstitutionName =
      typeof row.source_institution_name === "string" ? row.source_institution_name.trim() : "";
    let displayName = typeof row.display_name === "string" ? row.display_name : "";
    let hospitalName = typeof row.hospital_name === "string" ? row.hospital_name : "";

    if (sourceInstitutionName) {
      if (!displayName || displayName === siteId) {
        displayName = sourceInstitutionName;
      }
      if (!hospitalName || hospitalName === siteId) {
        hospitalName = sourceInstitutionName;
      }
    }

    return {
      site_id: siteId,
      display_name: displayName || hospitalName || sourceInstitutionName || siteId,
      hospital_name: hospitalName || displayName || sourceInstitutionName || siteId,
      ...(sourceInstitutionName ? { source_institution_name: sourceInstitutionName } : {}),
    };
  },
  appendDesktopDownloadEvent,
  desktopReleaseRowById,
  siteRowById,
  siteRowBySourceInstitutionId,
  upsertAccessRequestRecord,
}));

vi.mock("./main-app-bridge-users", () => ({
  authenticateMainAppUser: vi.fn(),
  buildLegacyAuthUser,
  buildMainAuthResponse,
  canonicalUserRowById: vi.fn(),
  requireMainAppBridgeUser,
}));

vi.mock("./main-app-bridge-shared", () => ({
  buildLocalAuthResponse,
  fetchLegacyLocalNodeApi: vi.fn(),
  legacyEmailForLocalUser,
  normalizeRegistryConsents: (value: unknown) => value ?? {},
  normalizeStringArray: (value: unknown) =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [],
  readBearerToken: vi.fn(),
  rowValue: (row: Record<string, unknown>, key: string) => row[key],
  trimText: (value: unknown) => (typeof value === "string" ? value.trim() : ""),
}));

vi.mock("./store", () => ({
  appendAuditEvent,
  ensureControlPlaneIdentity: vi.fn(),
}));

import {
  claimMainDesktopReleaseDownload,
  fetchMainBootstrap,
  fetchMainDesktopReleases,
  fetchSitesForMainUser,
  submitMainAccessRequest,
} from "./main-app-bridge";

describe("fetchSitesForMainUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns all sites for a global admin even when site_ids is empty", async () => {
    const sql = vi.fn().mockResolvedValue([
      {
        site_id: "39100103",
        display_name: "JNUH",
        hospital_name: "제주대학교병원",
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
        hospital_name: "제주대학교병원",
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

  it("hydrates admin site labels from the source institution name when raw HIRA codes are stored", async () => {
    const sql = vi.fn().mockResolvedValue([
      {
        site_id: "39100103",
        display_name: "39100103",
        hospital_name: "39100103",
        source_institution_name: "제주대학교병원",
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

    expect(result).toEqual([
      {
        site_id: "39100103",
        display_name: "제주대학교병원",
        hospital_name: "제주대학교병원",
        source_institution_name: "제주대학교병원",
      },
    ]);
  });

  it("hydrates membership-backed site labels from the source institution name", async () => {
    requireMainAppBridgeUser.mockResolvedValue({
      user: {
        role: "site_admin",
        site_ids: ["39100103"],
      },
      canonicalUser: {
        memberships: [
          {
            membership_id: "membership_1",
            site_id: "39100103",
            role: "site_admin",
            status: "approved",
            approved_at: "2026-03-22T00:00:00Z",
            created_at: "2026-03-22T00:00:00Z",
            site: {
              site_id: "39100103",
              display_name: "39100103",
              hospital_name: "39100103",
              source_institution_id: "39100103",
              source_institution_name: "제주대학교병원",
              status: "active",
              created_at: "2026-03-22T00:00:00Z",
            },
          },
        ],
      },
    });

    const result = await fetchSitesForMainUser({} as never);

    expect(controlPlaneSql).not.toHaveBeenCalled();
    expect(result).toEqual([
      {
        site_id: "39100103",
        display_name: "제주대학교병원",
        hospital_name: "제주대학교병원",
        source_institution_name: "제주대학교병원",
      },
    ]);
  });

  it("falls back to SQL site lookup when approved memberships omit embedded site records", async () => {
    const sql = vi.fn().mockResolvedValue([
      {
        site_id: "39100103",
        display_name: "",
        hospital_name: "Jeju University Hospital",
        source_institution_name: "Jeju University Hospital",
      },
    ]);
    requireMainAppBridgeUser.mockResolvedValue({
      user: {
        role: "researcher",
        site_ids: ["39100103"],
      },
      canonicalUser: {
        memberships: [
          {
            membership_id: "membership_1",
            site_id: "39100103",
            role: "member",
            status: "approved",
            approved_at: "2026-03-22T00:00:00Z",
            created_at: "2026-03-22T00:00:00Z",
            site: null,
          },
        ],
      },
    });
    controlPlaneSql.mockResolvedValue(sql);

    const result = await fetchSitesForMainUser({} as never);

    expect(controlPlaneSql).toHaveBeenCalledTimes(1);
    expect(sql).toHaveBeenCalledTimes(1);
    expect(result).toEqual([
      {
        site_id: "39100103",
        display_name: "Jeju University Hospital",
        hospital_name: "Jeju University Hospital",
        source_institution_name: "Jeju University Hospital",
      },
    ]);
  });

  it("returns user and sites from a single bootstrap call for approved users", async () => {
    const sql = vi.fn().mockResolvedValue([
      {
        site_id: "SITE_A",
        display_name: "Site A",
        hospital_name: "Hospital A",
      },
    ]);
    const approvedUser = {
      user_id: "user_researcher",
      username: "researcher",
      full_name: "Researcher",
      role: "researcher",
      site_ids: ["SITE_A"],
      approval_status: "approved",
    };
    requireMainAppBridgeUser.mockResolvedValue({
      canonicalUserId: "user_researcher",
      user: approvedUser,
    });
    controlPlaneSql.mockResolvedValue(sql);
    buildLocalAuthResponse.mockResolvedValue({
      auth_state: "approved",
      access_token: "token-approved",
      token_type: "bearer",
      user: approvedUser,
    });

    const result = await fetchMainBootstrap({} as never);

    expect(requireMainAppBridgeUser).toHaveBeenCalledTimes(1);
    expect(buildLocalAuthResponse).toHaveBeenCalledWith(approvedUser);
    expect(controlPlaneSql).toHaveBeenCalledTimes(1);
    expect(listAccessRequestsForCanonicalUser).not.toHaveBeenCalled();
    expect(result).toEqual({
      auth_state: "approved",
      access_token: "token-approved",
      token_type: "bearer",
      user: approvedUser,
      sites: [
        {
          site_id: "SITE_A",
          display_name: "Site A",
          hospital_name: "Hospital A",
        },
      ],
      my_access_requests: [],
    });
  });

  it("returns user and pending access requests from bootstrap for non-approved users", async () => {
    const pendingUser = {
      user_id: "user_pending",
      username: "pending",
      full_name: "Pending User",
      role: "viewer",
      site_ids: [],
      approval_status: "application_required",
    };
    const requests = [
      {
        request_id: "access_1",
        user_id: "user_pending",
        email: "pending@example.com",
        requested_site_id: "SITE_A",
        requested_role: "researcher",
        message: "",
        status: "pending",
        reviewed_by: null,
        reviewer_notes: "",
        created_at: "2026-03-20T00:00:00Z",
        reviewed_at: null,
      },
    ];
    requireMainAppBridgeUser.mockResolvedValue({
      canonicalUserId: "user_pending",
      user: pendingUser,
    });
    buildLocalAuthResponse.mockResolvedValue({
      auth_state: "application_required",
      access_token: "token-pending",
      token_type: "bearer",
      user: pendingUser,
    });
    listAccessRequestsForCanonicalUser.mockResolvedValue(requests);

    const result = await fetchMainBootstrap({} as never);

    expect(requireMainAppBridgeUser).toHaveBeenCalledTimes(1);
    expect(buildLocalAuthResponse).toHaveBeenCalledWith(pendingUser);
    expect(controlPlaneSql).not.toHaveBeenCalled();
    expect(listAccessRequestsForCanonicalUser).toHaveBeenCalledWith("user_pending");
    expect(result).toEqual({
      auth_state: "application_required",
      access_token: "token-pending",
      token_type: "bearer",
      user: pendingUser,
      sites: [],
      my_access_requests: requests,
    });
  });

  it("promotes bootstrap users when the latest access request is already approved", async () => {
    const sql = vi.fn().mockResolvedValue([
      {
        site_id: "SITE_A",
        display_name: "Site A",
        hospital_name: "Hospital A",
      },
    ]);
    const pendingUser = {
      user_id: "user_pending",
      username: "pending",
      full_name: "Pending User",
      role: "viewer",
      site_ids: [],
      approval_status: "application_required",
    };
    const approvedRequest = {
      request_id: "access_approved",
      user_id: "user_pending",
      email: "pending@example.com",
      requested_site_id: "SITE_A",
      requested_site_label: "Hospital A",
      requested_site_source: "site",
      resolved_site_id: "SITE_A",
      resolved_site_label: "Hospital A",
      requested_role: "researcher",
      message: "",
      status: "approved",
      reviewed_by: null,
      reviewer_notes: "Automatically approved researcher access request.",
      created_at: "2026-04-14T00:00:00Z",
      reviewed_at: "2026-04-14T00:00:05Z",
    };
    requireMainAppBridgeUser.mockResolvedValue({
      canonicalUserId: "user_pending",
      user: pendingUser,
      canonicalUser: {
        memberships: [],
      },
    });
    controlPlaneSql.mockResolvedValue(sql);
    listAccessRequestsForCanonicalUser.mockResolvedValue([approvedRequest]);
    buildLocalAuthResponse.mockResolvedValue({
      auth_state: "approved",
      access_token: "token-approved",
      token_type: "bearer",
      user: {
        ...pendingUser,
        role: "researcher",
        site_ids: ["SITE_A"],
        approval_status: "approved",
        latest_access_request: approvedRequest,
      },
    });

    const result = await fetchMainBootstrap({} as never);

    expect(buildLocalAuthResponse).toHaveBeenCalledWith({
      ...pendingUser,
      role: "researcher",
      site_ids: ["SITE_A"],
      approval_status: "approved",
      latest_access_request: approvedRequest,
    });
    expect(result).toEqual({
      auth_state: "approved",
      access_token: "token-approved",
      token_type: "bearer",
      user: {
        ...pendingUser,
        role: "researcher",
        site_ids: ["SITE_A"],
        approval_status: "approved",
        latest_access_request: approvedRequest,
      },
      sites: [
        {
          site_id: "SITE_A",
          display_name: "Site A",
          hospital_name: "Hospital A",
        },
      ],
      my_access_requests: [],
    });
  });

  it("lists active desktop releases for approved users", async () => {
    const approvedUser = {
      user_id: "user_researcher",
      username: "researcher",
      full_name: "Researcher",
      role: "researcher",
      site_ids: ["SITE_A"],
      approval_status: "approved",
    };
    const releases = [
      {
        release_id: "desktop_cpu_nsis_1_0_0",
        channel: "desktop_cpu_nsis",
        label: "K-ERA Desktop (CPU)",
        version: "1.0.0",
        platform: "windows",
        installer_type: "nsis",
        download_url: "https://example.com/download.exe",
        folder_url: "https://example.com/folder",
        sha256: "ABC",
        size_bytes: 100,
        notes: "CPU installer",
        active: true,
        created_at: "2026-04-14T00:00:00.000Z",
        updated_at: "2026-04-14T00:00:00.000Z",
        metadata_json: {},
      },
    ];
    requireMainAppBridgeUser.mockResolvedValue({
      canonicalUserId: "user_researcher",
      user: approvedUser,
    });
    listActiveDesktopReleases.mockResolvedValue(releases);

    await expect(fetchMainDesktopReleases({} as never)).resolves.toEqual(releases);
    expect(listActiveDesktopReleases).toHaveBeenCalledTimes(1);
  });

  it("logs desktop download claims with the selected site", async () => {
    const approvedUser = {
      user_id: "user_researcher",
      username: "researcher",
      full_name: "Researcher",
      role: "researcher",
      site_ids: ["SITE_A"],
      approval_status: "approved",
    };
    requireMainAppBridgeUser.mockResolvedValue({
      canonicalUserId: "user_researcher",
      user: approvedUser,
    });
    desktopReleaseRowById.mockResolvedValue({
      release_id: "desktop_cpu_nsis_1_0_0",
      channel: "desktop_cpu_nsis",
      label: "K-ERA Desktop (CPU)",
      version: "1.0.0",
      platform: "windows",
      installer_type: "nsis",
      download_url: "https://example.com/download.exe",
      folder_url: "https://example.com/folder",
      sha256: "ABC",
      size_bytes: 100,
      notes: "CPU installer",
      active: true,
      metadata_json: {},
      created_at: "2026-04-14T00:00:00.000Z",
      updated_at: "2026-04-14T00:00:00.000Z",
    });
    appendDesktopDownloadEvent.mockResolvedValue("download_1");

    const result = await claimMainDesktopReleaseDownload(
      {} as never,
      "desktop_cpu_nsis_1_0_0",
      { site_id: "SITE_A" },
    );

    expect(appendDesktopDownloadEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        releaseId: "desktop_cpu_nsis_1_0_0",
        userId: "user_researcher",
        username: "researcher",
        userRole: "researcher",
        siteId: "SITE_A",
      }),
    );
    expect(appendAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "desktop_release.download_claimed",
        targetId: "desktop_cpu_nsis_1_0_0",
      }),
    );
    expect(result).toEqual({
      event_id: "download_1",
      redirect_url: "https://example.com/download.exe",
      site_id: "SITE_A",
      release: {
        release_id: "desktop_cpu_nsis_1_0_0",
        channel: "desktop_cpu_nsis",
        label: "K-ERA Desktop (CPU)",
        version: "1.0.0",
        platform: "windows",
        installer_type: "nsis",
        download_url: "https://example.com/download.exe",
        folder_url: "https://example.com/folder",
        sha256: "ABC",
        size_bytes: 100,
        notes: "CPU installer",
        active: true,
        metadata_json: {},
        created_at: "2026-04-14T00:00:00.000Z",
        updated_at: "2026-04-14T00:00:00.000Z",
      },
    });
  });

  it("keeps hospital change requests pending for users who already have site access", async () => {
    const currentUser = {
      user_id: "user_researcher",
      username: "researcher",
      full_name: "Researcher",
      role: "researcher",
      site_ids: ["SITE_A"],
      approval_status: "approved",
    };
    const pendingRequest = {
      request_id: "access_change_1",
      user_id: "user_researcher",
      email: "researcher@example.com",
      requested_site_id: "SITE_B",
      requested_site_label: "Hospital B",
      requested_site_source: "site",
      requested_role: "researcher",
      message: "Switch me to Hospital B",
      status: "pending",
      reviewed_by: null,
      reviewer_notes: "",
      created_at: "2026-03-24T00:00:00Z",
      reviewed_at: null,
    };
    requireMainAppBridgeUser.mockResolvedValue({
      canonicalUserId: "user_researcher",
      user: currentUser,
      canonicalUser: {
        memberships: [],
      },
    });
    siteRowById.mockResolvedValue({
      site_id: "SITE_B",
      display_name: "Site B",
      hospital_name: "Hospital B",
    });
    institutionRowById.mockResolvedValue(null);
    siteRowBySourceInstitutionId.mockResolvedValue(null);
    latestAccessRequestForCanonicalUser.mockResolvedValue(null);
    legacyEmailForLocalUser.mockReturnValue("researcher@example.com");
    buildLegacyAuthUser.mockResolvedValue(currentUser);
    buildMainAuthResponse.mockResolvedValue({
      auth_state: "approved",
      access_token: "token-approved",
      token_type: "bearer",
      user: currentUser,
    });
    listAccessRequestsForCanonicalUser.mockResolvedValue([pendingRequest]);

    const result = await submitMainAccessRequest({} as never, {
      requested_site_id: "SITE_B",
      requested_role: "researcher",
      message: "Switch me to Hospital B",
    });

    expect(upsertAccessRequestRecord).toHaveBeenCalledTimes(1);
    expect(controlPlaneSql).not.toHaveBeenCalled();
    expect(result).toEqual({
      auth_state: "approved",
      access_token: "token-approved",
      token_type: "bearer",
      user: currentUser,
      request: pendingRequest,
    });
  });

  it("rejects duplicate requests when a canonical membership already maps the institution-directory site", async () => {
    const staleUser = {
      user_id: "user_researcher",
      username: "researcher",
      full_name: "Researcher",
      role: "viewer",
      site_ids: [],
      approval_status: "application_required",
    };
    requireMainAppBridgeUser.mockResolvedValue({
      canonicalUserId: "user_researcher",
      user: staleUser,
      canonicalUser: {
        memberships: [
          {
            membership_id: "membership_1",
            site_id: "39100103",
            role: "member",
            status: "approved",
            approved_at: "2026-04-14T00:00:00Z",
            created_at: "2026-04-14T00:00:00Z",
            site: null,
          },
        ],
      },
    });
    siteRowById.mockResolvedValue(null);
    institutionRowById.mockResolvedValue({
      institution_id: "JDQ4MTYyMiM4MSMkMSMkOCMkODkkMzgxMzUxIzExIyQxIyQzIyQ4OSQyNjE0ODEjNTEjJDEjJDYjJDgz",
      name: "제주대학교병원",
    });
    siteRowBySourceInstitutionId.mockResolvedValue({
      site_id: "39100103",
      display_name: "",
      hospital_name: "제주대학교병원",
    });

    await expect(
      submitMainAccessRequest({} as never, {
        requested_site_id: "JDQ4MTYyMiM4MSMkMSMkOCMkODkkMzgxMzUxIzExIyQxIyQzIyQ4OSQyNjE0ODEjNTEjJDEjJDYjJDgz",
        requested_role: "researcher",
        message: "duplicate",
      }),
    ).rejects.toThrow("You already have access to this hospital.");

    expect(upsertAccessRequestRecord).not.toHaveBeenCalled();
  });
});
