import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import process from "node:process";

import {
  buildDesktopShellCss,
  buildDesktopShellHtml,
  copyDesktopShellStaticAssets,
  createDesktopShellJsWatcher,
  desktopShellPaths,
  resetDesktopShellOutput,
} from "./desktop-shell-build-lib.mjs";

const frontendRoot = process.cwd();
const repoRoot = path.resolve(frontendRoot, "..");
const port = Number.parseInt(process.env.KERA_DESKTOP_SHELL_DEV_PORT ?? "3001", 10);
const host = "127.0.0.1";
const paths = desktopShellPaths(frontendRoot);
const cssWatchTargets = [
  path.join(frontendRoot, "desktop-shell", "desktop.css"),
  path.join(frontendRoot, "app", "globals.css"),
  path.join(frontendRoot, "app", "styles"),
];
const staticWatchTargets = [path.join(frontendRoot, "public", "landing")];
const liveReloadClients = new Set();

loadEnvIfPresent(path.join(frontendRoot, ".env.local"));
loadEnvIfPresent(path.join(frontendRoot, ".env"));
loadEnvIfPresent(path.join(repoRoot, ".env.local"));
loadEnvIfPresent(path.join(repoRoot, ".env"));

if (!Number.isInteger(port) || port <= 0) {
  console.error("[desktop-shell-dev] Invalid port.");
  process.exit(1);
}

const watchClosers = [];
let jsWatcher = null;
let server = null;
let refreshTimer = null;
let refreshQueue = Promise.resolve();

await resetDesktopShellOutput(frontendRoot);
await refreshDesktopShell("initial");
jsWatcher = await createDesktopShellJsWatcher(frontendRoot, {
  onEnd(result) {
    if (result.errors.length > 0) {
      console.error(`[desktop-shell-dev] JS rebuild failed with ${result.errors.length} error(s).`);
      return;
    }
    console.log("[desktop-shell-dev] JS rebuilt.");
    broadcastReload("js");
  },
});
server = http.createServer(handleRequest);
server.listen(port, host, () => {
  console.log(`[desktop-shell-dev] Ready on http://${host}:${port}`);
});

for (const target of cssWatchTargets) {
  watchClosers.push(...createWatchers(target, () => scheduleRefresh("styles changed")));
}
for (const target of staticWatchTargets) {
  watchClosers.push(...createWatchers(target, () => scheduleRefresh("assets changed")));
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await shutdown();
    process.exit(0);
  });
}

process.on("uncaughtException", async (error) => {
  console.error("[desktop-shell-dev] Uncaught exception.", error);
  await shutdown();
  process.exit(1);
});

process.on("unhandledRejection", async (error) => {
  console.error("[desktop-shell-dev] Unhandled rejection.", error);
  await shutdown();
  process.exit(1);
});

function loadEnvIfPresent(filePath) {
  try {
    process.loadEnvFile(filePath);
  } catch {
    // Optional env files may not exist.
  }
}

async function refreshDesktopShell(reason) {
  refreshQueue = refreshQueue
    .then(async () => {
      await Promise.all([
        buildDesktopShellCss(frontendRoot),
        copyDesktopShellStaticAssets(frontendRoot),
      ]);
      await buildDesktopShellHtml(frontendRoot);
      if (reason !== "initial") {
        console.log(`[desktop-shell-dev] Refreshed shell (${reason}).`);
        broadcastReload(reason);
      }
    })
    .catch((error) => {
      console.error("[desktop-shell-dev] Shell refresh failed.", error);
    });
  return refreshQueue;
}

function scheduleRefresh(reason) {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
  }
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void refreshDesktopShell(reason);
  }, 120);
}

function createWatchers(targetPath, onChange) {
  if (!fs.existsSync(targetPath)) {
    return [];
  }
  const stats = fs.statSync(targetPath);
  if (stats.isFile()) {
    const watcher = fs.watch(targetPath, onChange);
    return [() => watcher.close()];
  }

  const watchers = [];
  const stack = [targetPath];
  while (stack.length > 0) {
    const currentPath = stack.pop();
    if (!currentPath || !fs.existsSync(currentPath)) {
      continue;
    }
    const watcher = fs.watch(currentPath, onChange);
    watchers.push(() => watcher.close());
    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        stack.push(path.join(currentPath, entry.name));
      }
    }
  }
  return watchers;
}

async function handleRequest(request, response) {
  if (!request.url) {
    response.writeHead(400);
    response.end("Bad Request");
    return;
  }

  const requestUrl = new URL(request.url, `http://${host}:${port}`);
  const normalizedPath = decodeURIComponent(requestUrl.pathname);
  if (normalizedPath === "/__desktop_shell_events") {
    handleLiveReloadStream(response);
    return;
  }
  const resolvedPath = resolveOutputPath(normalizedPath);
  const filePath = await resolveServePath(resolvedPath);

  if (!filePath) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not Found");
    return;
  }

  if (path.extname(filePath).toLowerCase() === ".html") {
    const html = await fsp.readFile(filePath, "utf8");
    response.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(injectLiveReloadClient(html));
    return;
  }

  response.writeHead(200, {
    "Content-Type": contentTypeForPath(filePath),
    "Cache-Control": "no-store",
  });
  fs.createReadStream(filePath).pipe(response);
}

function resolveOutputPath(requestPath) {
  if (!requestPath || requestPath === "/") {
    return path.join(paths.outDir, "index.html");
  }
  const trimmedPath = requestPath.replace(/^\/+/, "");
  return path.join(paths.outDir, trimmedPath);
}

async function resolveServePath(candidatePath) {
  const normalizedRoot = path.resolve(paths.outDir);
  const resolvedCandidate = path.resolve(candidatePath);
  if (!resolvedCandidate.startsWith(normalizedRoot)) {
    return null;
  }

  try {
    const stats = await fsp.stat(resolvedCandidate);
    if (stats.isDirectory()) {
      const nestedIndex = path.join(resolvedCandidate, "index.html");
      return (await fileExists(nestedIndex)) ? nestedIndex : null;
    }
    return resolvedCandidate;
  } catch {
    if (!path.extname(resolvedCandidate)) {
      const indexPath = path.join(paths.outDir, "index.html");
      return (await fileExists(indexPath)) ? indexPath : null;
    }
    return null;
  }
}

async function fileExists(filePath) {
  try {
    const stats = await fsp.stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

function contentTypeForPath(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".svg":
      return "image/svg+xml";
    case ".ico":
      return "image/x-icon";
    case ".html":
    default:
      return "text/html; charset=utf-8";
  }
}

function injectLiveReloadClient(html) {
  const liveReloadClient = `
<script>
(() => {
  if (typeof window === "undefined" || typeof EventSource === "undefined") return;
  const source = new EventSource("/__desktop_shell_events");
  source.addEventListener("reload", () => {
    window.location.reload();
  });
})();
</script>`;
  return html.includes("</body>") ? html.replace("</body>", `${liveReloadClient}\n</body>`) : `${html}\n${liveReloadClient}`;
}

function handleLiveReloadStream(response) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
  });
  response.write("retry: 300\n\n");
  liveReloadClients.add(response);
  response.on("close", () => {
    liveReloadClients.delete(response);
  });
}

function broadcastReload(reason) {
  if (liveReloadClients.size === 0) {
    return;
  }
  const payload = JSON.stringify({
    reason,
    timestamp: Date.now(),
  });
  for (const client of liveReloadClients) {
    client.write(`event: reload\ndata: ${payload}\n\n`);
  }
}

async function shutdown() {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  for (const close of watchClosers.splice(0)) {
    close();
  }
  if (jsWatcher) {
    await jsWatcher.dispose();
    jsWatcher = null;
  }
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = null;
  }
  for (const client of liveReloadClients) {
    client.end();
  }
  liveReloadClients.clear();
}
