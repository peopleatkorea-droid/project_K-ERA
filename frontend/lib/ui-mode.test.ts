import { afterEach, describe, expect, it } from "vitest";

import { getKeraUiMode, isOperatorUiEnabled, isResearcherUiMode } from "./ui-mode";

describe("ui mode helpers", () => {
  const originalMode = process.env.NEXT_PUBLIC_KERA_UI_MODE;

  afterEach(() => {
    if (originalMode == null) {
      delete process.env.NEXT_PUBLIC_KERA_UI_MODE;
    } else {
      process.env.NEXT_PUBLIC_KERA_UI_MODE = originalMode;
    }
  });

  it("defaults to full mode", () => {
    delete process.env.NEXT_PUBLIC_KERA_UI_MODE;

    expect(getKeraUiMode()).toBe("full");
    expect(isOperatorUiEnabled()).toBe(true);
    expect(isResearcherUiMode()).toBe(false);
  });

  it("switches to researcher mode when requested", () => {
    process.env.NEXT_PUBLIC_KERA_UI_MODE = "researcher";

    expect(getKeraUiMode()).toBe("researcher");
    expect(isOperatorUiEnabled()).toBe(false);
    expect(isResearcherUiMode()).toBe(true);
  });

  it("treats unknown values as full mode", () => {
    process.env.NEXT_PUBLIC_KERA_UI_MODE = "unexpected";

    expect(getKeraUiMode()).toBe("full");
    expect(isOperatorUiEnabled()).toBe(true);
  });
});
