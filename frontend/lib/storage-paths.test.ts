import { describe, expect, it } from "vitest";

import { toStorageRootDisplayPath } from "./storage-paths";

describe("toStorageRootDisplayPath", () => {
  it("hides the Windows extended-length prefix for KERA_DATA bundle roots", () => {
    expect(toStorageRootDisplayPath("\\\\?\\C:\\Users\\USER\\Downloads\\KERA_DATA\\sites")).toBe(
      "C:\\Users\\USER\\Downloads\\KERA_DATA",
    );
  });

  it("hides the Windows extended-length prefix for direct site-root parents", () => {
    expect(toStorageRootDisplayPath("\\\\?\\C:\\Users\\USER\\Downloads\\SitesRoot")).toBe(
      "C:\\Users\\USER\\Downloads\\SitesRoot",
    );
  });

  it("normalizes extended UNC paths for display", () => {
    expect(toStorageRootDisplayPath("\\\\?\\UNC\\server\\share\\KERA_DATA\\sites")).toBe(
      "\\\\server\\share\\KERA_DATA",
    );
  });
});
