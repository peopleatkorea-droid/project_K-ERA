import React from "react";

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  createPatient: vi.fn(),
  downloadManifest: vi.fn(),
  fetchAccessRequests: vi.fn(),
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

vi.mock("./public/landing-v4", () => ({
  LandingV4: () => <div>Landing</div>,
}));

vi.mock("./case-workspace", () => ({
  CaseWorkspace: () => <div>Workspace</div>,
}));

vi.mock("./admin-workspace", () => ({
  AdminWorkspace: () => <div>Admin Workspace</div>,
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

import HomePage from "../app/page";

describe("HomePage history guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.history.replaceState(null, "", "/");
    vi.stubGlobal("scrollTo", vi.fn());

    window.localStorage.setItem("kera_web_token", "test-token");
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
    apiMocks.fetchMe.mockReset();
    apiMocks.fetchMe.mockImplementation(async () => {
      window.localStorage.setItem("kera_web_token", "rotated-token");
      return {
        user_id: "user_researcher",
        username: "researcher",
        full_name: "Researcher",
        role: "researcher",
        site_ids: ["SITE_A"],
        approval_status: "approved",
      };
    });

    render(<HomePage />);

    expect(await screen.findByText("Workspace")).toBeInTheDocument();

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 20));
    });

    expect(apiMocks.fetchMe).toHaveBeenCalledTimes(1);
    expect(apiMocks.fetchSites).toHaveBeenCalledTimes(1);
  });

  it("filters existing fallback institutions with Korean region aliases", async () => {
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
      expect(apiMocks.submitAccessRequest).toHaveBeenCalledWith("test-token", expect.objectContaining({ requested_site_id: "SITE_A" }));
    });
    await waitFor(() => {
      expect(apiMocks.fetchSites).toHaveBeenCalledWith("test-token");
    });
    expect(await screen.findByText("Workspace")).toBeInTheDocument();
  });

  it("opens the admin workspace when an approved admin lands on the operations route", async () => {
    window.history.replaceState(null, "", "/?workspace=operations&section=dashboard");
    apiMocks.fetchMe.mockResolvedValueOnce({
      user_id: "user_admin",
      username: "admin",
      full_name: "Admin",
      role: "admin",
      site_ids: ["SITE_A"],
      approval_status: "approved",
    });

    render(<HomePage />);

    expect(await screen.findByText("Admin Workspace")).toBeInTheDocument();
    expect(screen.queryByText("Landing")).not.toBeInTheDocument();
  });

  it("shows the case workspace before the site list bootstrap finishes for approved users", async () => {
    let releaseSites: ((value: Array<{ site_id: string; display_name: string; hospital_name: string }>) => void) | null = null;
    apiMocks.fetchMe.mockResolvedValueOnce({
      user_id: "user_researcher",
      username: "researcher",
      full_name: "Researcher",
      role: "researcher",
      site_ids: ["SITE_A"],
      approval_status: "approved",
    });
    apiMocks.fetchSites.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseSites = resolve;
        }),
    );

    render(<HomePage />);

    expect(await screen.findByText("Workspace")).toBeInTheDocument();
    expect(screen.queryByText("Opening your workspace")).not.toBeInTheDocument();

    await act(async () => {
      releaseSites?.([
        {
          site_id: "SITE_A",
          display_name: "Site A",
          hospital_name: "Hospital A",
        },
      ]);
      await Promise.resolve();
    });
  });

  it("shows admin operations before the site list bootstrap finishes", async () => {
    let releaseSites: ((value: Array<{ site_id: string; display_name: string; hospital_name: string }>) => void) | null = null;
    window.history.replaceState(null, "", "/?workspace=operations&section=dashboard");
    apiMocks.fetchMe.mockResolvedValueOnce({
      user_id: "user_admin",
      username: "admin",
      full_name: "Admin",
      role: "admin",
      site_ids: ["SITE_A"],
      approval_status: "approved",
    });
    apiMocks.fetchSites.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseSites = resolve;
        }),
    );

    render(<HomePage />);

    expect(await screen.findByText("Admin Workspace")).toBeInTheDocument();

    await act(async () => {
      releaseSites?.([
        {
          site_id: "SITE_A",
          display_name: "Site A",
          hospital_name: "Hospital A",
        },
      ]);
      await Promise.resolve();
    });
  });
});
