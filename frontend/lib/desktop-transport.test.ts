import { beforeEach, describe, expect, it, vi } from "vitest";

const desktopIpcMocks = vi.hoisted(() => ({
  clearDesktopFileSrcCache: vi.fn(),
  convertDesktopFilePath: vi.fn(async (path: string | null | undefined) => {
    const normalized = String(path ?? "").trim();
    return normalized ? `asset://${normalized}` : null;
  }),
  hasDesktopRuntime: vi.fn(() => true),
  invokeDesktop: vi.fn(),
  throwIfAborted: vi.fn(),
}));

const tokenPayloadMocks = vi.hoisted(() => ({
  readUserIdFromToken: vi.fn(() => "user_1"),
}));

vi.mock("./desktop-ipc", () => ({
  clearDesktopFileSrcCache: desktopIpcMocks.clearDesktopFileSrcCache,
  convertDesktopFilePath: desktopIpcMocks.convertDesktopFilePath,
  hasDesktopRuntime: desktopIpcMocks.hasDesktopRuntime,
  invokeDesktop: desktopIpcMocks.invokeDesktop,
  throwIfAborted: desktopIpcMocks.throwIfAborted,
}));

vi.mock("./token-payload", () => ({
  readUserIdFromToken: tokenPayloadMocks.readUserIdFromToken,
}));

describe("desktop-transport", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
    desktopIpcMocks.hasDesktopRuntime.mockReturnValue(true);
    desktopIpcMocks.convertDesktopFilePath.mockImplementation(async (path: string | null | undefined) => {
      const normalized = String(path ?? "").trim();
      return normalized ? `asset://${normalized}` : null;
    });
  });

  it("hydrates desktop patient list thumbnails with generated preview URLs", async () => {
    desktopIpcMocks.invokeDesktop
      .mockResolvedValueOnce({
        items: [
          {
            patient_id: "patient-1",
            latest_case: {
              case_id: "case-2",
              patient_id: "patient-1",
              chart_alias: "",
              local_case_code: "",
              culture_category: "bacterial",
              culture_species: "Moraxella",
              additional_organisms: [],
              visit_date: "FU #1",
              actual_visit_date: null,
              created_by_user_id: "user_1",
              created_at: "2026-03-22T00:00:00Z",
              latest_image_uploaded_at: "2026-03-22T00:00:00Z",
              image_count: 1,
              representative_image_id: "image-2",
              representative_view: "white",
              age: 76,
              sex: "male",
              visit_status: "active",
              is_initial_visit: false,
              smear_result: "not done",
              polymicrobial: false,
            },
            case_count: 2,
            organism_summary: "Moraxella",
            representative_thumbnails: [
              {
                case_id: "case-2",
                image_id: "image-2",
                view: "white",
                preview_url: null,
                fallback_url: null,
                preview_path: null,
                fallback_path: "workspace/images/image-2.jpg",
              },
              {
                case_id: "case-1",
                image_id: "image-1",
                view: "fluorescein",
                preview_url: null,
                fallback_url: null,
                preview_path: null,
                fallback_path: "workspace/images/image-1.heic",
              },
            ],
          },
        ],
        page: 1,
        page_size: 25,
        total_count: 1,
        total_pages: 1,
      })
      .mockResolvedValueOnce([
        {
          image_id: "image-2",
          preview_path: "preview-cache/image-2.png",
          fallback_path: "workspace/images/image-2.jpg",
          ready: true,
        },
        {
          image_id: "image-1",
          preview_path: "preview-cache/image-1.png",
          fallback_path: "workspace/images/image-1.heic",
          ready: true,
        },
      ]);

    const mod = await import("./desktop-transport");
    const response = await mod.fetchDesktopPatientListPage("SITE_A", "desktop-token");

    expect(desktopIpcMocks.invokeDesktop).toHaveBeenNthCalledWith(
      1,
      "list_patient_board",
      {
        payload: {
          site_id: "SITE_A",
          created_by_user_id: null,
          page: 1,
          page_size: 25,
          search: null,
        },
      },
      undefined,
    );
    expect(desktopIpcMocks.invokeDesktop).toHaveBeenNthCalledWith(
      2,
      "ensure_image_previews",
      {
        payload: {
          site_id: "SITE_A",
          image_ids: ["image-2", "image-1"],
          max_side: 160,
        },
      },
      undefined,
    );
    expect(response.items[0]?.representative_thumbnails[0]?.preview_url).toBe("asset://preview-cache/image-2.png");
    expect(response.items[0]?.representative_thumbnails[1]?.preview_url).toBe("asset://preview-cache/image-1.png");
    expect(response.items[0]?.representative_thumbnails[1]?.fallback_url).toBe("asset://workspace/images/image-1.heic");
  });
});
