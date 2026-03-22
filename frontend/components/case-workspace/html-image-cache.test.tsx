import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearCachedHtmlImages, loadCachedHtmlImage } from "./html-image-cache";

class MockImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  decoding = "";
  crossOrigin: string | null = null;
  naturalWidth = 320;
  naturalHeight = 240;
  width = 320;
  height = 240;
  private _src = "";

  set src(value: string) {
    this._src = value;
    queueMicrotask(() => {
      this.onload?.();
    });
  }

  get src() {
    return this._src;
  }
}

describe("html-image-cache", () => {
  const createdImages: MockImage[] = [];
  const createObjectUrlMock = vi.fn(() => "blob:canvas-safe-image");
  const revokeObjectUrlMock = vi.fn(() => undefined);

  beforeEach(() => {
    clearCachedHtmlImages();
    createdImages.length = 0;
    createObjectUrlMock.mockClear();
    revokeObjectUrlMock.mockClear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.stubGlobal(
      "Image",
      class extends MockImage {
        constructor() {
          super();
          createdImages.push(this);
        }
      },
    );
    vi.stubGlobal("fetch", vi.fn());
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: createObjectUrlMock,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: revokeObjectUrlMock,
    });
  });

  it("loads desktop asset images through a blob URL for canvas-safe rendering", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValue({
      ok: true,
      blob: vi.fn().mockResolvedValue(new Blob(["mask"], { type: "image/png" })),
    } as Response);

    const image = await loadCachedHtmlImage("asset://localhost/mask.png");

    expect(fetchMock).toHaveBeenCalledWith("asset://localhost/mask.png");
    expect(createObjectUrlMock).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrlMock).toHaveBeenCalledWith("blob:canvas-safe-image");
    expect(createdImages[0]?.src).toBe("blob:canvas-safe-image");
    expect(createdImages[0]?.crossOrigin).toBe("anonymous");
    expect(image).toBe(createdImages[0]);
  });

  it("keeps standard URLs on the direct image loading path", async () => {
    const fetchMock = vi.mocked(fetch);

    const image = await loadCachedHtmlImage("https://example.com/source.png");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(createObjectUrlMock).not.toHaveBeenCalled();
    expect(revokeObjectUrlMock).not.toHaveBeenCalled();
    expect(createdImages[0]?.src).toBe("https://example.com/source.png");
    expect(createdImages[0]?.crossOrigin).toBe("anonymous");
    expect(image).toBe(createdImages[0]);
  });
});
