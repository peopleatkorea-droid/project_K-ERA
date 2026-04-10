import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const routerReplace = vi.hoisted(() => vi.fn());
const apiMocks = vi.hoisted(() => ({
  login: vi.fn(),
  devLogin: vi.fn(),
  fetchSites: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: routerReplace,
  }),
}));

vi.mock("../lib/api", () => ({
  login: apiMocks.login,
  devLogin: apiMocks.devLogin,
  fetchSites: apiMocks.fetchSites,
}));

vi.mock("../lib/i18n", () => ({
  LocaleToggle: () => <div>Locale toggle</div>,
  pick: (_locale: string, en: string) => en,
  translateApiError: (_locale: string, message: string) => message,
  useI18n: () => ({ locale: "en" }),
}));

import AdminLoginPage from "../app/admin-login/page";

describe("AdminLoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NEXT_PUBLIC_KERA_UI_MODE;
    window.localStorage.clear();
    window.history.replaceState(null, "", "/admin-login");
    apiMocks.fetchSites.mockResolvedValue([
      {
        site_id: "39100103",
        display_name: "제주대학교병원",
        hospital_name: "제주대학교병원",
        source_institution_name: "제주대학교병원",
      },
    ]);
    apiMocks.login.mockResolvedValue({
      access_token: "admin-token",
      token_type: "bearer",
      user: {
        user_id: "user_admin",
        username: "admin",
        full_name: "Admin",
        role: "admin",
        site_ids: [],
        approval_status: "approved",
      },
    });
  });

  it("redirects direct admin login to the default workspace path", async () => {
    const { container } = render(<AdminLoginPage />);

    fireEvent.change(container.querySelector("#username") as HTMLInputElement, { target: { value: "admin" } });
    fireEvent.change(container.querySelector("#password") as HTMLInputElement, { target: { value: "admin123" } });
    fireEvent.click(screen.getByRole("button", { name: "Enter operator workspace" }));

    await waitFor(() => {
      expect(apiMocks.login).toHaveBeenCalledWith("admin", "admin123");
    });
    await waitFor(() => {
      expect(apiMocks.fetchSites).toHaveBeenCalledWith("admin-token");
    });
    await waitFor(() => {
      expect(routerReplace).toHaveBeenCalledWith("/");
    });
    expect(window.localStorage.getItem("kera_web_token")).toBe("admin-token");
    expect(window.localStorage.getItem("kera_cached_site_records_v1")).toContain("제주대학교병원");
  });

  it("respects safe next targets after admin login", async () => {
    window.history.replaceState(null, "", "/admin-login?next=%2F%3Fworkspace%3Doperations%26section%3Dtraining");

    const { container } = render(<AdminLoginPage />);

    fireEvent.change(container.querySelector("#username") as HTMLInputElement, { target: { value: "admin" } });
    fireEvent.change(container.querySelector("#password") as HTMLInputElement, { target: { value: "admin123" } });
    fireEvent.click(screen.getByRole("button", { name: "Enter operator workspace" }));

    await waitFor(() => {
      expect(apiMocks.login).toHaveBeenCalledWith("admin", "admin123");
    });
    await waitFor(() => {
      expect(apiMocks.fetchSites).toHaveBeenCalledWith("admin-token");
    });
    await waitFor(() => {
      expect(routerReplace).toHaveBeenCalledWith("/?workspace=operations&section=training");
    });
  });

  it("falls back to the default path for unsafe next targets", async () => {
    window.history.replaceState(null, "", "/admin-login?next=%2F%2Fevil.example");

    const { container } = render(<AdminLoginPage />);

    fireEvent.change(container.querySelector("#username") as HTMLInputElement, { target: { value: "admin" } });
    fireEvent.change(container.querySelector("#password") as HTMLInputElement, { target: { value: "admin123" } });
    fireEvent.click(screen.getByRole("button", { name: "Enter operator workspace" }));

    await waitFor(() => {
      expect(apiMocks.login).toHaveBeenCalledWith("admin", "admin123");
    });
    await waitFor(() => {
      expect(apiMocks.fetchSites).toHaveBeenCalledWith("admin-token");
    });
    await waitFor(() => {
      expect(routerReplace).toHaveBeenCalledWith("/");
    });
  });

  it("hides operator sign-in when the researcher UI mode is enabled", () => {
    process.env.NEXT_PUBLIC_KERA_UI_MODE = "researcher";

    render(<AdminLoginPage />);

    expect(screen.getByText("Operator sign-in is hidden in this build")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enter operator workspace" })).not.toBeInTheDocument();
  });
});
