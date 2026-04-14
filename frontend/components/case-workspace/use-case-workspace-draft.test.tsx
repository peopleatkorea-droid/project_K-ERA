import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useCaseWorkspaceDraftState } from "./use-case-workspace-draft";

const persistenceMocks = vi.hoisted(() => ({
  readPersistedDraftAssets: vi.fn(async () => null),
  writePersistedDraftAssets: vi.fn(async () => undefined),
  deletePersistedDraftAssets: vi.fn(async () => undefined),
}));

vi.mock("../../lib/draft-persistence", () => ({
  readPersistedDraftAssets: persistenceMocks.readPersistedDraftAssets,
  writePersistedDraftAssets: persistenceMocks.writePersistedDraftAssets,
  deletePersistedDraftAssets: persistenceMocks.deletePersistedDraftAssets,
}));

function Harness() {
  const {
    draft,
    draftSavedAt,
    replaceDraftImages,
    setDraft,
  } = useCaseWorkspaceDraftState({
    selectedSiteId: "SITE_A",
    userId: "user_researcher",
    recoveredDraftMessage: "recovered",
    recoveredDraftWithAssetsMessage: "recovered-assets",
    cultureSpecies: {
      bacterial: ["Pseudomonas"],
    },
    setToast: vi.fn(),
    createDraft: () => ({
      patient_id: "",
      chart_alias: "",
      local_case_code: "",
      sex: "unknown",
      age: "",
      actual_visit_date: "",
      follow_up_number: "",
      culture_category: "bacterial",
      culture_species: "Pseudomonas",
      additional_organisms: [],
      contact_lens_use: "none",
      visit_status: "active",
      is_initial_visit: true,
      predisposing_factor: [],
      other_history: "",
      intake_completed: false,
    }),
    normalizeRecoveredDraft: (nextDraft) => nextDraft,
    hasDraftContent: (nextDraft) => Boolean(nextDraft.patient_id.trim()),
    draftStorageKey: (userId, siteId) => `draft:${userId}:${siteId}`,
    favoriteStorageKey: (userId, siteId) => `favorites:${userId}:${siteId}`,
  });

  return (
    <div>
      <button
        type="button"
        onClick={() =>
          replaceDraftImages([
            {
              draft_id: "draft_image_1",
              file: new File(["image-binary"], "slit.png", {
                type: "image/png",
                lastModified: 1700000000000,
              }),
              preview_url: "blob:slit",
              view: "white",
              is_representative: true,
            },
          ])
        }
      >
        add-image
      </button>
      <button
        type="button"
        onClick={() =>
          setDraft((current) => ({
            ...current,
            patient_id: "KERA-2026-001",
          }))
        }
      >
        update-draft
      </button>
      <div data-testid="patient-id">{draft.patient_id}</div>
      <div data-testid="saved-at">{draftSavedAt ?? ""}</div>
    </div>
  );
}

async function flushAutosave() {
  await act(async () => {
    vi.advanceTimersByTime(500);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useCaseWorkspaceDraftState", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.localStorage.clear();
    persistenceMocks.readPersistedDraftAssets.mockClear();
    persistenceMocks.readPersistedDraftAssets.mockResolvedValue(null);
    persistenceMocks.writePersistedDraftAssets.mockClear();
    persistenceMocks.deletePersistedDraftAssets.mockClear();
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        revokeObjectURL: vi.fn(),
      }),
    );
  });

  it("does not rewrite persisted draft image assets when only text fields change", async () => {
    render(<Harness />);

    await act(async () => {
      vi.advanceTimersByTime(0);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(persistenceMocks.readPersistedDraftAssets).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "add-image" }));
    await flushAutosave();

    expect(persistenceMocks.writePersistedDraftAssets).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "update-draft" }));
    await flushAutosave();
    await act(async () => {
      vi.runOnlyPendingTimers();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(persistenceMocks.writePersistedDraftAssets).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("patient-id")).toHaveTextContent("KERA-2026-001");
    expect(screen.getByTestId("saved-at")).not.toBeEmptyDOMElement();
  });
});
