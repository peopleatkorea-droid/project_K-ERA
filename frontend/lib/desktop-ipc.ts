"use client";

declare global {
  interface Window {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: {
      invoke?: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
    };
  }
}

function createAbortError(): DOMException | Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException("The operation was aborted.", "AbortError");
  }
  const error = new Error("The operation was aborted.");
  error.name = "AbortError";
  return error;
}

export function hasDesktopRuntime(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return Boolean(window.__TAURI__ || typeof window.__TAURI_INTERNALS__?.invoke === "function");
}

export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

export async function invokeDesktop<T>(
  command: string,
  args: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<T> {
  if (!hasDesktopRuntime()) {
    throw new Error("Desktop runtime is unavailable.");
  }
  throwIfAborted(signal);
  const { invoke } = await import("@tauri-apps/api/core");
  throwIfAborted(signal);
  const result = await invoke<T>(command, args);
  throwIfAborted(signal);
  return result;
}

export async function listenDesktopEvent<T>(
  eventName: string,
  onEvent: (payload: T) => void | Promise<void>,
): Promise<() => void> {
  if (!hasDesktopRuntime()) {
    throw new Error("Desktop runtime is unavailable.");
  }
  const { listen } = await import("@tauri-apps/api/event");
  return listen<T>(eventName, async (event) => {
    await onEvent(event.payload);
  });
}

const desktopFileSrcCache = new Map<string, string>();

export async function convertDesktopFilePath(path: string | null | undefined): Promise<string | null> {
  const normalized = typeof path === "string" ? path.trim() : "";
  if (!normalized) {
    return null;
  }
  const cached = desktopFileSrcCache.get(normalized);
  if (cached) {
    return cached;
  }
  if (!hasDesktopRuntime()) {
    return normalized;
  }
  const { convertFileSrc } = await import("@tauri-apps/api/core");
  const assetUrl = convertFileSrc(normalized);
  desktopFileSrcCache.set(normalized, assetUrl);
  return assetUrl;
}

export function clearDesktopFileSrcCache() {
  desktopFileSrcCache.clear();
}
