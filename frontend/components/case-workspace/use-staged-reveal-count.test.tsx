import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useStagedRevealCount } from "./use-staged-reveal-count";

describe("useStagedRevealCount", () => {
  it("resets staged visibility when the reset key changes even if the total count stays the same", () => {
    vi.useFakeTimers();
    try {
      const { result, rerender } = renderHook(
        ({
          totalCount,
          initialCount,
          resetKey,
        }: {
          totalCount: number;
          initialCount: number;
          resetKey: string;
        }) =>
          useStagedRevealCount({
            totalCount,
            initialCount,
            resetKey,
          }),
        {
          initialProps: {
            totalCount: 3,
            initialCount: 1,
            resetKey: "case_a",
          },
        },
      );

      expect(result.current).toBe(1);

      act(() => {
        vi.runAllTimers();
      });

      expect(result.current).toBe(3);

      rerender({
        totalCount: 3,
        initialCount: 1,
        resetKey: "case_b",
      });

      expect(result.current).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
