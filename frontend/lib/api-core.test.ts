import { afterEach, describe, expect, it, vi } from "vitest";

describe("buildApiUrl", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    delete process.env.NEXT_PUBLIC_LOCAL_NODE_API_BASE_URL;
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("defaults to same-origin api paths even when local node helpers are configured", async () => {
    process.env.NEXT_PUBLIC_LOCAL_NODE_API_BASE_URL = "http://127.0.0.1:8000";

    const { buildApiUrl } = await import("./api-core");

    expect(buildApiUrl("/api/health")).toBe("/api/health");
  });

  it("uses NEXT_PUBLIC_API_BASE_URL when it is explicitly configured", async () => {
    process.env.NEXT_PUBLIC_API_BASE_URL = "http://127.0.0.1:8100";

    const { buildApiUrl } = await import("./api-core");

    expect(buildApiUrl("/api/health")).toBe("http://127.0.0.1:8100/api/health");
  });

  it("preserves AbortError instead of reporting the local API as unavailable", async () => {
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    const fetchMock = vi.fn().mockRejectedValue(abortError);
    vi.stubGlobal("fetch", fetchMock);

    const { request } = await import("./api-core");

    await expect(request("/api/health", { signal: new AbortController().signal })).rejects.toBe(abortError);
  });
});
