import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useViewportActivation } from "./use-viewport-activation";

describe("useViewportActivation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("activates immediately when the element is already near the viewport", () => {
    const { result } = renderHook(() =>
      useViewportActivation<HTMLElement>({ rootMargin: 320 }),
    );

    const element = {
      getBoundingClientRect: () => ({
        top: 120,
        bottom: 420,
      }),
    } as HTMLElement;

    act(() => {
      result.current.activationRef(element);
    });

    expect(result.current.isActive).toBe(true);
  });

  it("activates later through IntersectionObserver when the element starts outside the viewport", async () => {
    let observedCallback:
      | ((entries: Array<{ isIntersecting: boolean; intersectionRatio: number }>) => void)
      | null = null;

    class MockIntersectionObserver {
      constructor(
        callback: (entries: Array<{ isIntersecting: boolean; intersectionRatio: number }>) => void,
      ) {
        observedCallback = callback;
      }
      observe() {}
      disconnect() {}
    }

    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

    const { result } = renderHook(() =>
      useViewportActivation<HTMLElement>({ rootMargin: 320 }),
    );

    const element = {
      getBoundingClientRect: () => ({
        top: 5000,
        bottom: 5400,
      }),
    } as HTMLElement;

    act(() => {
      result.current.activationRef(element);
    });

    expect(result.current.isActive).toBe(false);
    await waitFor(() => {
      expect(observedCallback).not.toBeNull();
    });

    await act(async () => {
      observedCallback?.([{ isIntersecting: true, intersectionRatio: 1 }]);
    });

    expect(result.current.isActive).toBe(true);
  });
});
