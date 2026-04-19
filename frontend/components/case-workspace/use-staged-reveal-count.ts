"use client";

import { useEffect, useState } from "react";

import { scheduleDeferredBrowserTask } from "./case-workspace-site-data-helpers";

type UseStagedRevealCountArgs = {
  totalCount: number;
  initialCount: number;
  delayMs?: number;
  resetKey?: string | number | null;
};

export function useStagedRevealCount({
  totalCount,
  initialCount,
  delayMs = 120,
  resetKey = null,
}: UseStagedRevealCountArgs) {
  const normalizedInitialCount = Math.max(
    0,
    Math.min(initialCount, totalCount),
  );
  const [visibleCount, setVisibleCount] = useState(normalizedInitialCount);

  useEffect(() => {
    setVisibleCount(normalizedInitialCount);
    if (totalCount <= normalizedInitialCount) {
      return;
    }

    let cancelled = false;
    let revealedCount = normalizedInitialCount;
    let cancelDeferredReveal = () => undefined;

    const revealNextItem = () => {
      if (cancelled) {
        return;
      }
      revealedCount += 1;
      setVisibleCount((current) =>
        current >= revealedCount ? current : revealedCount,
      );
      if (revealedCount < totalCount) {
        cancelDeferredReveal = scheduleDeferredBrowserTask(
          revealNextItem,
          delayMs,
        );
      }
    };

    cancelDeferredReveal = scheduleDeferredBrowserTask(
      revealNextItem,
      delayMs,
    );
    return () => {
      cancelled = true;
      cancelDeferredReveal();
    };
  }, [delayMs, normalizedInitialCount, resetKey, totalCount]);

  return visibleCount;
}
