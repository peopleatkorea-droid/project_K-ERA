"use client";

import { ensureDesktopLocalWorkerReady } from "./desktop-diagnostics";
import { hasDesktopRuntime } from "./desktop-ipc";
import { ensureDesktopMlBackendReady } from "./desktop-sidecar-config";

let workerPrewarmPromise: Promise<void> | null = null;
let mlPrewarmPromise: Promise<void> | null = null;

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
