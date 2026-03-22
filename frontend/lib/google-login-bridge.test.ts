import { describe, expect, it, vi } from "vitest";

import {
  findGoogleInteractive,
  renderGoogleButtons,
  resetGoogleButtonHost,
  triggerRenderedGoogleButton,
  type GoogleAccountsIdApi,
} from "./google-login-bridge";

describe("google login bridge", () => {
  it("marks rendered GIS hosts as ready", () => {
    const host = document.createElement("div");
    const initialize = vi.fn();
    const renderButton = vi.fn((element: HTMLElement) => {
      const button = document.createElement("div");
      button.setAttribute("role", "button");
      element.appendChild(button);
    });

    renderGoogleButtons({
      callback: () => undefined,
      clientId: "test-google-client-id",
      googleButtonWidth: 320,
      googleId: {
        initialize,
        renderButton,
      } satisfies GoogleAccountsIdApi,
      hosts: [host],
    });

    expect(initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: "test-google-client-id",
      }),
    );
    expect(renderButton).toHaveBeenCalledWith(
      host,
      expect.objectContaining({
        width: 320,
      }),
    );
    expect(host.dataset.googleReady).toBe("true");
    expect(findGoogleInteractive(host)).not.toBeNull();
  });

  it("resets stale hosts before GIS re-renders", () => {
    const host = document.createElement("div");
    host.dataset.googleReady = "true";
    host.appendChild(document.createElement("button"));

    resetGoogleButtonHost(host);

    expect(host.dataset.googleReady).toBe("false");
    expect(host.childElementCount).toBe(0);
  });

  it("clicks the rendered GIS control only when the host is ready", () => {
    const host = document.createElement("div");
    const interactiveClick = vi.fn();
    const interactive = document.createElement("button");

    interactive.type = "button";
    interactive.addEventListener("click", interactiveClick);
    host.appendChild(interactive);

    expect(triggerRenderedGoogleButton(host)).toBe(false);
    expect(interactiveClick).not.toHaveBeenCalled();

    host.dataset.googleReady = "true";

    expect(triggerRenderedGoogleButton(host)).toBe(true);
    expect(interactiveClick).toHaveBeenCalledTimes(1);
  });
});
