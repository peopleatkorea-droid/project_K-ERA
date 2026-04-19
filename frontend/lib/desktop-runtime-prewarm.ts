"use client";

import { ensureDesktopLocalWorkerReady } from "./desktop-diagnostics";
import { hasDesktopRuntime } from "./desktop-ipc";
import { ensureDesktopMlBackendReady } from "./desktop-sidecar-config";

let workerPrewarmPromise: Promise<void> | null = null;
let mlPrewarmPromise: Promise<void> | null = null;
let runtimePrewarmPromise: Promise<void> | null = null;
let lastDesktopInteractionAt = 0;

function currentTimestampMs() {
  return Date.now();
}

function dedupePrewarm(
  current: Promise<void> | null,
  assign: (next: Promise<void> | null) => void,
  run: () => Promise<unknown>,
) {
  if (!hasDesktopRuntime()) {
    return Promise.resolve();
  }
  if (current) {
    return current;
  }
  const nextPromise = run()
    .then(() => undefined)
    .finally(() => {
      assign(null);
    });
  assign(nextPromise);
  return nextPromise;
}

export function prewarmDesktopWorker() {
  return dedupePrewarm(workerPrewarmPromise, (next) => {
    workerPrewarmPromise = next;
  }, () => ensureDesktopLocalWorkerReady());
}

export function prewarmDesktopMlBackend() {
  return dedupePrewarm(mlPrewarmPromise, (next) => {
    mlPrewarmPromise = next;
  }, () => ensureDesktopMlBackendReady());
}

export function prewarmDesktopRuntime() {
  if (!hasDesktopRuntime()) {
    return Promise.resolve();
  }
  if (runtimePrewarmPromise) {
    return runtimePrewarmPromise;
  }
  const nextPromise = prewarmDesktopWorker()
    .then(() => prewarmDesktopMlBackend())
    .finally(() => {
      runtimePrewarmPromise = null;
    });
  runtimePrewarmPromise = nextPromise;
  return nextPromise;
}

export function markDesktopInteraction() {
  lastDesktopInteractionAt = currentTimestampMs();
}

export function resetDesktopInteractionTrackingForTests() {
  lastDesktopInteractionAt = 0;
}

export function runAfterDesktopInteractionIdle(
  task: () => void,
  cooldownMs = 2400,
) {
  if (typeof window === "undefined") {
    task();
    return () => undefined;
  }
  let cancelled = false;
  let timeoutId: number | null = null;

  const runWhenReady = () => {
    if (cancelled) {
      return;
    }
    const remainingMs =
      lastDesktopInteractionAt > 0
        ? cooldownMs - (currentTimestampMs() - lastDesktopInteractionAt)
        : 0;
    if (remainingMs <= 0) {
      task();
      return;
    }
    timeoutId = window.setTimeout(runWhenReady, Math.max(remainingMs, 24));
  };

  runWhenReady();

  return () => {
    cancelled = true;
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  };
}
