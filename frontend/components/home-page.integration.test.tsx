import React from "react";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  createPatient: vi.fn(),
  downloadManifest: vi.fn(),
  fetchAccessRequests: vi.fn(),
  fetchMainBootstrap: vi.fn(),
  fetchMe: vi.fn(),
  fetchMyAccessRequests: vi.fn(),
  fetchPatients: vi.fn(),
  fetchPublicSites: vi.fn(),
  searchPublicInstitutions: vi.fn(),
  fetchSiteSummary: vi.fn(),
  fetchSites: vi.fn(),
  googleLogin: vi.fn(),
  reviewAccessRequest: vi.fn(),
  submitAccessRequest: vi.fn(),
}));

const webDataPlaneMocks = vi.hoisted(() => ({
  probeWebDataPlaneAvailability: vi.fn(),
}));

const desktopTransportMocks = vi.hoisted(() => ({
  canUseDesktopTransport: vi.fn(() => false),
  prefetchDesktopVisitImages: vi.fn(),
}));

vi.mock("./public/landing-v4", () => ({
  LandingV4: () => <div>Landing</div>,
}));

vi.mock("./case-workspace", () => ({
  CaseWorkspace: ({
    onOpenOperations,
  }: {
    onOpenOperations?: (section?: "management" | "dashboard" | "training" | "cross_validation") => void;
  }) => (
    <div>
      <div>Workspace</div>
      <button type="button" onClick={() => onOpenOperations?.()}>
        Open Operations
      </button>
    </div>
  ),
}));

vi.mock("./admin-workspace", () => ({
  AdminWorkspace: ({ initialSection }: { initialSection?: string }) => (
    <div>
      <div>Admin Workspace</div>
      <div data-testid="admin-initial-section">{initialSection ?? ""}</div>
    </div>
  ),
}));

vi.mock("./ui/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}));

vi.mock("./ui/card", () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("./ui/field", () => ({
  Field: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("./ui/section-header", () => ({
  SectionHeader: ({
    eyebrow,
    title,
    description,
    aside,
  }: {
    eyebrow?: React.ReactNode;
    title?: React.ReactNode;
    description?: React.ReactNode;
    aside?: React.ReactNode;
  }) => (
    <div>
      {eyebrow}
      {title}
      {description}
      {aside}
    </div>
  ),
}));

vi.mock("../lib/i18n", () => ({
  LocaleToggle: () => <div>Locale toggle</div>,
  pick: (_locale: string, en: string) => en,
  translateApiError: (_locale: string, message: string) => message,
  translateRole: (_locale: string, role: string) => role,
  translateStatus: (_locale: string, status: string) => status,
  useI18n: () => ({ locale: "en" }),
}));

vi.mock("../lib/theme", () => ({
  useTheme: () => ({
    resolvedTheme: "light",
    setTheme: vi.fn(),
  }),
}));

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return {
    ...actual,
    createPatient: apiMocks.createPatient,
    downloadManifest: apiMocks.downloadManifest,
    fetchAccessRequests: apiMocks.fetchAccessRequests,
    fetchMainBootstrap: apiMocks.fetchMainBootstrap,
    fetchMe: apiMocks.fetchMe,
    fetchMyAccessRequests: apiMocks.fetchMyAccessRequests,
    fetchPatients: apiMocks.fetchPatients,
    fetchPublicSites: apiMocks.fetchPublicSites,
    searchPublicInstitutions: apiMocks.searchPublicInstitutions,
    fetchSiteSummary: apiMocks.fetchSiteSummary,
    fetchSites: apiMocks.fetchSites,
    googleLogin: apiMocks.googleLogin,
    reviewAccessRequest: apiMocks.reviewAccessRequest,
    submitAccessRequest: apiMocks.submitAccessRequest,
  };
});

vi.mock("../lib/web-data-plane", () => ({
  probeWebDataPlaneAvailability: webDataPlaneMocks.probeWebDataPlaneAvailability,
}));

vi.mock("../lib/desktop-transport", () => ({
  canUseDesktopTransport: desktopTransportMocks.canUseDesktopTransport,
  prefetchDesktopVisitImages: desktopTransportMocks.prefetchDesktopVisitImages,
}));

import HomePage from "../app/page";

function makeStoredToken(
  payload: Partial<{
    sub: string;
    username: string;
    full_name: string;
    public_alias: string | null;
    role: string;
    site_ids: string[];
    approval_status: string;
    exp: number;
  }> = {},
) {
  const header = { alg: "HS256", typ: "JWT" };
  const claims = {
    sub: "user_researcher",
    username: "researcher",
    full_name: "Researcher",
    public_alias: null,
    role: "researcher",
    site_ids: ["SITE_A"],
    approval_status: "approved",
    exp: 4102444800,
    ...payload,
  };
  const encode = (value: unknown) =>
    window
      .btoa(JSON.stringify(value))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  return `${encode(header)}.${encode(claims)}.signature`;
}

describe("HomePage history guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
    vi.stubGlobal("scrollTo", vi.fn());

    const approvedToken = makeStoredToken();
    window.localStorage.setItem("kera_web_token", approvedToken);
    apiMocks.fetchMainBootstrap.mockResolvedValue({
      auth_state: "approved",
      access_token: approvedToken,
      token_type: "bearer",
      user: {
        user_id: "user_researcher",
        username: "researcher",
        full_name: "Researcher",
        role: "researcher",
        site_ids: ["SITE_A"],
        approval_status: "approved",
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
    apiMocks.fetchMe.mockResolvedValue({
      user_id: "user_researcher",
      username: "researcher",
      full_name: "Researcher",
      role: "researcher",
      site_ids: ["SITE_A"],
      approval_status: "approved",
    });
    apiMocks.fetchSites.mockResolvedValue([
      {
        site_id: "SITE_A",
        display_name: "Site A",
        hospital_name: "Hospital A",
      },
    ]);
    apiMocks.fetchSiteSummary.mockResolvedValue({
      site_id: "SITE_A",
      n_patients: 0,
      n_visits: 0,
      n_images: 0,
      n_active_visits: 0,
      n_validation_runs: 0,
      latest_validation: null,
    });
    apiMocks.fetchPatients.mockResolvedValue([]);
    apiMocks.fetchPublicSites.mockResolvedValue([]);
    apiMocks.fetchMyAccessRequests.mockResolvedValue([]);
    apiMocks.fetchAccessRequests.mockResolvedValue([]);
    apiMocks.searchPublicInstitutions.mockResolvedValue([]);
    webDataPlaneMocks.probeWebDataPlaneAvailability.mockResolvedValue(true);
    desktopTransportMocks.canUseDesktopTransport.mockReturnValue(false);
    desktopTransportMocks.prefetchDesktopVisitImages.mockImplementation(() => undefined);
  });

  it("keeps the workspace visible when browser back is pressed on the initial screen", async () => {
    render(<HomePage />);

    expect(await screen.findByText("Workspace")).toBeInTheDocument();

    await act(async () => {
      window.history.back();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(screen.getByText("Workspace")).toBeInTheDocument();
    expect(screen.queryByText("Landing")).not.toBeInTheDocument();
  });

  it("does not restart bootstrap when fetchMe rotates the stored token", async () => {
    const rotatedToken = makeStoredToken({ username: "researcher-rotated" });
    apiMocks.fetchMainBootstrap.mockReset();
    apiMocks.fetchMainBootstrap.mockImplementation(async () => {
      window.localStorage.setItem("kera_web_token", rotatedToken);
      return {
        auth_state: "approved",
        access_token: rotatedToken,
        token_type: "bearer",
        user: {
          user_id: "user_researcher",
          username: "researcher",
          full_name: "Researcher",
          role: "researcher",
          site_ids: ["SITE_A"],
          approval_status: "approved",
        },
        sites: [
          {
            site_id: "SITE_A",
            display_name: "Site A",
            hospital_name: "Hospital A",
          },
        ],
        my_access_requests: [],
      };
    });

    render(<HomePage />);

    expect(await screen.findByText("Workspace")).toBeInTheDocument();

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });

    expect(apiMocks.fetchMainBootstrap).toHaveBeenCalledTimes(1);
    expect(apiMocks.fetchSites).toHaveBeenCalledTimes(0);
  });

  it("filters existing fallback institutions with Korean region aliases", async () => {
    const pendingToken = makeStoredToken({
      sub: "user_pending",
      username: "pending",
      full_name: "Pending User",
      role: "viewer",
      site_ids: [],
      approval_status: "application_required",
    });
    window.localStorage.setItem("kera_web_token", pendingToken);
    apiMocks.fetchMainBootstrap.mockResolvedValueOnce({
      auth_state: "application_required",
      access_token: pendingToken,
      token_type: "bearer",
      user: {
        user_id: "user_researcher",
        username: "pending",
        full_name: "Pending User",
        role: "viewer",
        site_ids: [],
        approval_status: "application_required",
      },
      sites: [],
      my_access_requests: [],
    });
    apiMocks.fetchPublicSites.mockResolvedValueOnce([
      {
        site_id: "JEJU_SITE",
        display_name: "Jeju National University Hospital",
        hospital_name: "Jeju National University Hospital",
      },
      {
        site_id: "SEOUL_SITE",
        display_name: "Seoul St. Mary's Hospital",
        hospital_name: "Seoul St. Mary's Hospital",
      },
    ]);
    apiMocks.searchPublicInstitutions.mockResolvedValue([]);

    render(<HomePage />);

    const searchInput = await screen.findByPlaceholderText("Seoul, Asan, Kim's Eye...");
    fireEvent.change(searchInput, { target: { value: "제주" } });

    await waitFor(() => {
      expect(apiMocks.searchPublicInstitutions).toHaveBeenCalledWith("제주", { limit: 8 });
    });
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Jeju National University Hospital" })).toBeInTheDocument();
      expect(screen.queryByRole("option", { name: "Seoul St. Mary's Hospital" })).not.toBeInTheDocument();
    });
  });

  it("opens the workspace immediately after an auto-approved institution request", async () => {
    const pendingToken = makeStoredToken({
      sub: "user_pending",
      username: "pending",
      full_name: "Pending User",
      role: "viewer",
      site_ids: [],
      approval_status: "application_required",
    });
    window.localStorage.setItem("kera_web_token", pendingToken);
    const approvedRequest = {
      request_id: "access_auto_1",
      user_id: "user_pending",
      email: "pending@example.com",
      requested_site_id: "SITE_A",
      requested_site_label: "Site A",
      requested_site_source: "site",
      resolved_site_id: "SITE_A",
      resolved_site_label: "Site A",
      requested_role: "researcher",
      message: "Need access",
      status: "approved",
      reviewed_by: null,
      reviewer_notes: "Automatically approved researcher access request.",
      created_at: "2026-03-17T00:00:00Z",
      reviewed_at: "2026-03-17T00:01:00Z",
    };
    apiMocks.fetchMainBootstrap.mockResolvedValueOnce({
      auth_state: "application_required",
      access_token: pendingToken,
      token_type: "bearer",
      user: {
        user_id: "user_pending",
        username: "pending",
        full_name: "Pending User",
        role: "viewer",
        site_ids: [],
        approval_status: "application_required",
      },
      sites: [],
      my_access_requests: [],
    });
    apiMocks.fetchMe.mockResolvedValueOnce({
      user_id: "user_pending",
      username: "pending",
      full_name: "Pending User",
      role: "viewer",
      site_ids: [],
      approval_status: "application_required",
    });
    apiMocks.fetchPublicSites.mockResolvedValueOnce([
      {
        site_id: "SITE_A",
        display_name: "Site A",
        hospital_name: "Hospital A",
      },
    ]);
    apiMocks.fetchMyAccessRequests.mockResolvedValueOnce([]).mockResolvedValueOnce([approvedRequest]);
    apiMocks.submitAccessRequest.mockResolvedValueOnce({
      access_token: "test-token",
      token_type: "bearer",
      user: {
        user_id: "user_pending",
        username: "pending",
        full_name: "Pending User",
        role: "researcher",
        site_ids: ["SITE_A"],
        approval_status: "approved",
      },
      request: approvedRequest,
      auth_state: "approved",
    });

    render(<HomePage />);

    const siteSelect = await screen.findByRole("combobox");
    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Hospital A" })).toBeInTheDocument();
    });
    fireEvent.change(siteSelect, { target: { value: "SITE_A" } });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Submit institution request" })).not.toBeDisabled();
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit institution request" }));

    await waitFor(() => {
      expect(apiMocks.submitAccessRequest).toHaveBeenCalledWith(pendingToken, expect.objectContaining({ requested_site_id: "SITE_A" }));
    });
    await waitFor(() => {
      expect(apiMocks.fetchSites).toHaveBeenCalledWith(pendingToken);
    });
    expect(await screen.findByText("Workspace")).toBeInTheDocument();
  });

  it("opens the admin workspace when an approved admin lands on the operations route", async () => {
    const adminToken = makeStoredToken({
      sub: "user_admin",
      username: "admin",
      full_name: "Admin",
      role: "admin",
      site_ids: ["SITE_A"],
      approval_status: "approved",
    });
    window.localStorage.setItem("kera_web_token", adminToken);
    window.history.replaceState(null, "", "/?workspace=operations&section=dashboard");
    apiMocks.fetchMainBootstrap.mockResolvedValueOnce({
      auth_state: "approved",
      access_token: adminToken,
      token_type: "bearer",
      user: {
        user_id: "user_admin",
        username: "admin",
        full_name: "Admin",
        role: "admin",
        site_ids: ["SITE_A"],
        approval_status: "approved",
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

    render(<HomePage />);

    expect(await screen.findByText("Admin Workspace")).toBeInTheDocument();
    expect(screen.getByTestId("admin-initial-section")).toHaveTextContent("dashboard");
    expect(screen.queryByText("Landing")).not.toBeInTheDocument();
  });

  it("defaults the admin workspace to management when operations is opened without a section", async () => {
    const adminToken = makeStoredToken({
      sub: "user_admin",
      username: "admin",
      full_name: "Admin",
      role: "admin",
      site_ids: ["SITE_A"],
      approval_status: "approved",
    });
    window.localStorage.setItem("kera_web_token", adminToken);
    apiMocks.fetchMainBootstrap.mockResolvedValueOnce({
      auth_state: "approved",
      access_token: adminToken,
      token_type: "bearer",
      user: {
        user_id: "user_admin",
        username: "admin",
        full_name: "Admin",
        role: "admin",
        site_ids: ["SITE_A"],
        approval_status: "approved",
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

    render(<HomePage />);

    expect(await screen.findByText("Workspace")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Operations" }));

    expect(await screen.findByText("Admin Workspace")).toBeInTheDocument();
    expect(screen.getByTestId("admin-initial-section")).toHaveTextContent("management");
  });

  it("shows the case workspace before the site list bootstrap finishes for approved users", async () => {
    const approvedToken = makeStoredToken();
    window.localStorage.setItem("kera_web_token", approvedToken);
    let releaseBootstrap:
      | ((value: {
          auth_state: "approved";
          access_token: string;
          token_type: "bearer";
          user: {
            user_id: string;
            username: string;
            full_name: string;
            role: string;
            site_ids: string[];
            approval_status: "approved";
          };
          sites: Array<{ site_id: string; display_name: string; hospital_name: string }>;
          my_access_requests: [];
        }) => void)
      | null = null;
    apiMocks.fetchMainBootstrap.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseBootstrap = resolve;
        }),
    );

    render(<HomePage />);

    expect(await screen.findByText("Workspace")).toBeInTheDocument();
    expect(screen.queryByText("Opening your workspace")).not.toBeInTheDocument();

    await act(async () => {
      releaseBootstrap?.({
        auth_state: "approved",
        access_token: approvedToken,
        token_type: "bearer",
        user: {
          user_id: "user_researcher",
          username: "researcher",
          full_name: "Researcher",
          role: "researcher",
          site_ids: ["SITE_A"],
          approval_status: "approved",
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
      await Promise.resolve();
    });
  });

  it("waits until bootstrap finishes before loading the selected hospital summary", async () => {
    const approvedToken = makeStoredToken();
    window.localStorage.setItem("kera_web_token", approvedToken);
    let releaseBootstrap:
      | ((value: {
          auth_state: "approved";
          access_token: string;
          token_type: "bearer";
          user: {
            user_id: string;
            username: string;
            full_name: string;
            role: string;
            site_ids: string[];
            approval_status: "approved";
          };
          sites: Array<{ site_id: string; display_name: string; hospital_name: string }>;
          my_access_requests: [];
        }) => void)
      | null = null;
    apiMocks.fetchMainBootstrap.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseBootstrap = resolve;
        }),
    );

    render(<HomePage />);

    expect(await screen.findByText("Workspace")).toBeInTheDocument();
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 320));
    });
    expect(apiMocks.fetchSiteSummary).not.toHaveBeenCalled();
    await act(async () => {
      releaseBootstrap?.({
        auth_state: "approved",
        access_token: approvedToken,
        token_type: "bearer",
        user: {
          user_id: "user_researcher",
          username: "researcher",
          full_name: "Researcher",
          role: "researcher",
          site_ids: ["SITE_A"],
          approval_status: "approved",
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
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(apiMocks.fetchSiteSummary).toHaveBeenCalledWith("SITE_A", approvedToken);
    });
  });

  it("shows a control-plane-only guard when the web data plane is unavailable", async () => {
    webDataPlaneMocks.probeWebDataPlaneAvailability.mockResolvedValue(false);

    render(<HomePage />);

    expect(
      await screen.findByText((content) => content.includes("Patient workspace is unavailable on this web deployment")),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Workspace$/)).not.toBeInTheDocument();
    expect(apiMocks.fetchSiteSummary).not.toHaveBeenCalled();
  });

  it("shows admin operations before the site list bootstrap finishes", async () => {
    const adminToken = makeStoredToken({
      sub: "user_admin",
      username: "admin",
      full_name: "Admin",
      role: "admin",
      site_ids: ["SITE_A"],
      approval_status: "approved",
    });
    window.localStorage.setItem("kera_web_token", adminToken);
    let releaseBootstrap:
      | ((value: {
          auth_state: "approved";
          access_token: string;
          token_type: "bearer";
          user: {
            user_id: string;
            username: string;
            full_name: string;
            role: string;
            site_ids: string[];
            approval_status: "approved";
          };
          sites: Array<{ site_id: string; display_name: string; hospital_name: string }>;
          my_access_requests: [];
        }) => void)
      | null = null;
    window.history.replaceState(null, "", "/?workspace=operations&section=dashboard");
    apiMocks.fetchMainBootstrap.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseBootstrap = resolve;
        }),
    );

    render(<HomePage />);

    expect(await screen.findByText("Admin Workspace")).toBeInTheDocument();

    await act(async () => {
      releaseBootstrap?.({
        auth_state: "approved",
        access_token: adminToken,
        token_type: "bearer",
        user: {
          user_id: "user_admin",
          username: "admin",
          full_name: "Admin",
          role: "admin",
          site_ids: ["SITE_A"],
          approval_status: "approved",
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
      await Promise.resolve();
    });
  });
});
