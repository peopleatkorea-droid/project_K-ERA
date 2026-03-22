"use client";

import { hasDesktopRuntime } from "./desktop-ipc";

const GITHUB_LATEST_RELEASE_URL = "https://api.github.com/repos/peopleatkorea-droid/project_K-ERA/releases/latest";

type TauriUpdateHandle = {
  body?: string | null;
  currentVersion: string;
  date?: string | null;
  version: string;
  downloadAndInstall: (
    onEvent?: (event: { event: string; data?: { chunkLength?: number; contentLength?: number } }) => void,
  ) => Promise<void>;
};

type GithubReleaseAsset = {
  browser_download_url?: string;
  name?: string;
};

type GithubLatestRelease = {
  assets?: GithubReleaseAsset[];
  body?: string | null;
  html_url?: string | null;
  name?: string | null;
  published_at?: string | null;
  tag_name?: string | null;
};

export type DesktopUpdateSource = "plugin" | "github" | "none";

export type DesktopUpdateCheckResult = {
  available: boolean;
  availableVersion: string | null;
  currentVersion: string | null;
  downloadUrl: string | null;
  error: string | null;
  installable: boolean;
  notes: string | null;
  publishedAt: string | null;
  source: DesktopUpdateSource;
  updateHandle: TauriUpdateHandle | null;
};

export type DesktopUpdateInstallResult = "relaunched" | "restart_required";

function normalizeVersion(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .replace(/^v/i, "")
    .replace(/\+.*$/, "");
}

function parseSemver(value: string) {
  const normalized = normalizeVersion(value);
  const [core, prerelease = ""] = normalized.split("-", 2);
  const parts = core.split(".").map((part) => Number.parseInt(part, 10));
  if (!parts.length || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  return { parts, prerelease };
}

function compareSemver(left: string, right: string) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a || !b) {
    return normalizeVersion(left).localeCompare(normalizeVersion(right), undefined, { numeric: true });
  }
  const length = Math.max(a.parts.length, b.parts.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.parts[index] ?? 0;
    const rightPart = b.parts[index] ?? 0;
    if (leftPart !== rightPart) {
      return leftPart - rightPart;
    }
  }
  if (!a.prerelease && b.prerelease) {
    return 1;
  }
  if (a.prerelease && !b.prerelease) {
    return -1;
  }
  return a.prerelease.localeCompare(b.prerelease);
}

async function desktopAppVersion(): Promise<string | null> {
  if (!hasDesktopRuntime()) {
    return null;
  }
  const { getVersion } = await import("@tauri-apps/api/app");
  return await getVersion();
}

async function fetchGithubLatestRelease(): Promise<GithubLatestRelease> {
  const response = await fetch(GITHUB_LATEST_RELEASE_URL, {
    headers: {
      Accept: "application/vnd.github+json",
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`GitHub release check failed: ${response.status}`);
  }
  return (await response.json()) as GithubLatestRelease;
}

function preferredReleaseDownloadUrl(release: GithubLatestRelease): string | null {
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const preferredAsset =
    assets.find((asset) => String(asset.name || "").toLowerCase().endsWith(".msi")) ||
    assets.find((asset) => String(asset.name || "").toLowerCase().includes("setup.exe")) ||
    assets.find((asset) => String(asset.browser_download_url || "").trim());
  return String(preferredAsset?.browser_download_url || release.html_url || "").trim() || null;
}

export async function checkDesktopForUpdates(): Promise<DesktopUpdateCheckResult | null> {
  if (!hasDesktopRuntime()) {
    return null;
  }

  const currentVersion = await desktopAppVersion();
  let pluginError: string | null = null;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = (await check()) as TauriUpdateHandle | null;
    if (update) {
      return {
        available: true,
        availableVersion: normalizeVersion(update.version),
        currentVersion: normalizeVersion(update.currentVersion),
        downloadUrl: null,
        error: null,
        installable: true,
        notes: String(update.body || "").trim() || null,
        publishedAt: String(update.date || "").trim() || null,
        source: "plugin",
        updateHandle: update,
      };
    }
    return {
      available: false,
      availableVersion: null,
      currentVersion: normalizeVersion(currentVersion),
      downloadUrl: null,
      error: null,
      installable: false,
      notes: null,
      publishedAt: null,
      source: "none",
      updateHandle: null,
    };
  } catch (error) {
    pluginError = error instanceof Error ? error.message : String(error);
  }

  try {
    const release = await fetchGithubLatestRelease();
    const latestVersion = normalizeVersion(release.tag_name || release.name || "");
    if (currentVersion && latestVersion && compareSemver(latestVersion, currentVersion) > 0) {
      return {
        available: true,
        availableVersion: latestVersion,
        currentVersion: normalizeVersion(currentVersion),
        downloadUrl: preferredReleaseDownloadUrl(release),
        error: pluginError,
        installable: false,
        notes: String(release.body || "").trim() || null,
        publishedAt: String(release.published_at || "").trim() || null,
        source: "github",
        updateHandle: null,
      };
    }
    return {
      available: false,
      availableVersion: latestVersion || null,
      currentVersion: normalizeVersion(currentVersion),
      downloadUrl: preferredReleaseDownloadUrl(release),
      error: pluginError,
      installable: false,
      notes: String(release.body || "").trim() || null,
      publishedAt: String(release.published_at || "").trim() || null,
      source: "none",
      updateHandle: null,
    };
  } catch (error) {
    return {
      available: false,
      availableVersion: null,
      currentVersion: normalizeVersion(currentVersion),
      downloadUrl: null,
      error: pluginError || (error instanceof Error ? error.message : String(error)),
      installable: false,
      notes: null,
      publishedAt: null,
      source: "none",
      updateHandle: null,
    };
  }
}

export async function installDesktopUpdate(
  updateHandle: TauriUpdateHandle,
  onEvent?: (event: { event: string; data?: { chunkLength?: number; contentLength?: number } }) => void,
): Promise<DesktopUpdateInstallResult> {
  await updateHandle.downloadAndInstall(onEvent);
  try {
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
    return "relaunched";
  } catch {
    return "restart_required";
  }
}
