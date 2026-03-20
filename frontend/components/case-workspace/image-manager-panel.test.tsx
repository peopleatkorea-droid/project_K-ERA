import React, { createRef, type ComponentProps } from "react";

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ImageManagerPanel } from "./image-manager-panel";

function buildProps(
  overrides: Partial<ComponentProps<typeof ImageManagerPanel>> = {}
): ComponentProps<typeof ImageManagerPanel> {
  return {
    locale: "ko",
    intakeCompleted: true,
    resolvedVisitReferenceLabel: "초진",
    whiteDraftImages: [],
    fluoresceinDraftImages: [],
    draftLesionPromptBoxes: {},
    whiteFileInputRef: createRef<HTMLInputElement>(),
    fluoresceinFileInputRef: createRef<HTMLInputElement>(),
    openFilePicker: vi.fn(),
    appendFiles: vi.fn(),
    handleDraftLesionPointerDown: vi.fn(),
    handleDraftLesionPointerMove: vi.fn(),
    finishDraftLesionPointer: vi.fn(),
    removeDraftImage: vi.fn(),
    setRepresentativeImage: vi.fn(),
    onSaveCase: vi.fn(),
    saveBusy: false,
    selectedSiteId: "39100103",
    ...overrides,
  };
}

describe("ImageManagerPanel", () => {
  it("lays out the white and fluorescein lanes in a two-column grid on wide screens", () => {
    render(<ImageManagerPanel {...buildProps()} />);

    const whiteLane = screen.getByText("White (Slit) 레인").closest("section");
    const fluoresceinLane = screen.getByText("Fluorescein 레인").closest("section");
    const laneGrid = whiteLane?.parentElement;

    expect(whiteLane).not.toBeNull();
    expect(fluoresceinLane).not.toBeNull();
    expect(laneGrid).not.toBeNull();
    expect(laneGrid?.className).toContain("xl:grid-cols-2");
    expect(laneGrid).toContainElement(whiteLane);
    expect(laneGrid).toContainElement(fluoresceinLane);
  });

  it("keeps each lane dropzone anchored to the top when the paired lane grows taller", () => {
    render(<ImageManagerPanel {...buildProps()} />);

    const whiteLane = screen.getByText("White (Slit) 레인").closest("section");
    const fluoresceinLane = screen.getByText("Fluorescein 레인").closest("section");

    expect(whiteLane?.className).toContain("content-start");
    expect(fluoresceinLane?.className).toContain("content-start");
  });
});
