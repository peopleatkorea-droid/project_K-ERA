import React, { useRef, useState } from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  fetchMainBootstrap: vi.fn(),
  fetchMyAccessRequests: vi.fn(),
  fetchPatientListPage: vi.fn(),
  fetchPublicSites: vi.fn(),
  searchPublicInstitutions: vi.fn(),
  submitAccessRequest: vi.fn(),
}));

const authMocks = vi.hoisted(() => ({
  googleLogin: vi.fn(),
}));

const desktopMocks = vi.hoisted(() => ({
  canUseDesktopTransport: vi.fn(() => false),
  prefetchDesktopVisitImages: vi.fn(),
}));

const approvedWorkspaceState = vi.hoisted(() => ({
  applyApprovedWorkspaceState: vi.fn(),
  clearApprovedWorkspaceState: vi.fn(),
  refreshApprovedSites: vi.fn(),
  refreshSiteData: vi.fn(),
  setSelectedSiteId: vi.fn(),
  setSummary: vi.fn(),
}));

vi.mock("../../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../../lib/api")>("../../lib/api");
  return {
    ...actual,
    ...apiMocks,
  };
});

vi.mock("../../lib/auth", () => ({
  googleLogin: authMocks.googleLogin,
}));

vi.mock("../../lib/desktop-transport", () => desktopMocks);

vi.mock("../../app/home-page-auth-shared", async () => {
  const actual = await vi.importActual<typeof import("../../app/home-page-auth-shared")>(
    "../../app/home-page-auth-shared",
  );
  return {
    ...actual,
    GOOGLE_CLIENT_ID: "test-google-client-id",
  };
});

vi.mock("../../app/use-approved-workspace-state", () => ({
  useApprovedWorkspaceState: () => ({
    ...approvedWorkspaceState,
    selectedSiteId: null,
    siteError: null,
    sites: [],
    summary: null,
  }),
}));

import { useHomeAuthBootstrap } from "../../app/use-home-auth-bootstrap";

function GoogleLoginHarness({ googleReady = true }: { googleReady?: boolean }) {
  const googleButtonRefs = useRef<HTMLDivElement[]>([]);
  const [requestForm, setRequestForm] = useState({
    requested_site_id: "",
    requested_site_label: "",
    requested_role: "researcher",
    message: "",
  });
  const { handleGoogleLaunch } = useHomeAuthBootstrap({
    copy: {
      failedConnect: "failedConnect",
      failedLoadSiteData: "failedLoadSiteData",
      googleDisabled: "googleDisabled",
      googleLoginFailed: "googleLoginFailed",
      googleNoCredential: "googleNoCredential",
      googlePreparing: "googlePreparing",
      requestSubmissionFailed: "requestSubmissionFailed",
      unableLoadInstitutions: "unableLoadInstitutions",
    },
    deferredInstitutionQuery: "",
    describeError: (_error, fallback) => fallback,
    googleButtonRefs,
    googleButtonSlotVersion: 1,
    googleButtonWidth: 320,
    googleReady,
    requestForm,
    setRequestForm,
  });

  return (
    <>
      <button type="button" onClick={handleGoogleLaunch}>
        Launch Google
      </button>
      <div
        data-testid="google-host"
        ref={(node) => {
          googleButtonRefs.current = node ? [node] : [];
        }}
      />
    </>
  );
}

describe("landing google login overlay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    window.google = undefined;
  });

  it("marks the google slot ready after GIS renders a button", async () => {
    const initialize = vi.fn();
    const renderButton = vi.fn((host: HTMLElement) => {
      const button = document.createElement("div");
      button.setAttribute("role", "button");
      host.appendChild(button);
    });

    window.google = {
      accounts: {
        id: {
          initialize,
          renderButton,
          prompt: vi.fn(),
        },
      },
    } as unknown as Window["google"];

    render(<GoogleLoginHarness />);

    await waitFor(() => {
      expect(renderButton).toHaveBeenCalledTimes(1);
    });

    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: "test-google-client-id",
      }),
    );
    expect(screen.getByTestId("google-host")).toHaveAttribute("data-google-ready", "true");
  });

  it("routes fake CTA clicks to the rendered GIS button once the slot is ready", async () => {
    const interactiveClick = vi.fn();
    const prompt = vi.fn();
    const renderButton = vi.fn((host: HTMLElement) => {
      const button = document.createElement("button");
      button.type = "button";
      button.addEventListener("click", interactiveClick);
      host.appendChild(button);
    });

    window.google = {
      accounts: {
        id: {
          initialize: vi.fn(),
          renderButton,
          prompt,
        },
      },
    } as unknown as Window["google"];

    render(<GoogleLoginHarness />);

    await waitFor(() => {
      expect(screen.getByTestId("google-host")).toHaveAttribute("data-google-ready", "true");
    });

    fireEvent.click(screen.getByRole("button", { name: "Launch Google" }));

    expect(interactiveClick).toHaveBeenCalledTimes(1);
    expect(prompt).not.toHaveBeenCalled();
  });
});
