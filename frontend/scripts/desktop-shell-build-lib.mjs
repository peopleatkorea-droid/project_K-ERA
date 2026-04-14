import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import * as esbuild from "esbuild";
import postcss from "postcss";

import postcssConfig from "../postcss.config.mjs";

export function desktopShellPaths(rootDir = process.cwd()) {
  const outDir = path.join(rootDir, "desktop-dist");
  return {
    rootDir,
    outDir,
    outAssetsDir: path.join(outDir, "assets"),
  };
}

async function copyDirectory(sourceDir, targetDir) {
  await fs.mkdir(targetDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      const sourcePath = path.join(sourceDir, entry.name);
      const targetPath = path.join(targetDir, entry.name);
      if (entry.isDirectory()) {
        await copyDirectory(sourcePath, targetPath);
        return;
      }
      await fs.copyFile(sourcePath, targetPath);
    }),
  );
}

async function loadPostCssPlugins() {
  return Promise.all(
    Object.entries(postcssConfig.plugins || {}).map(async ([name, options]) => {
      const mod = await import(name);
      return mod.default(options);
    }),
  );
}

function buildClientEnv() {
  const entries = {
    NODE_ENV: process.env.NODE_ENV || "production",
    NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000",
    NEXT_PUBLIC_LOCAL_NODE_API_BASE_URL: process.env.NEXT_PUBLIC_LOCAL_NODE_API_BASE_URL || "http://127.0.0.1:8000",
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "",
    NEXT_PUBLIC_GOOGLE_DESKTOP_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_DESKTOP_CLIENT_ID || "",
    NEXT_PUBLIC_KERA_UI_MODE: process.env.NEXT_PUBLIC_KERA_UI_MODE || process.env.KERA_UI_MODE || "full",
    NEXT_PUBLIC_KERA_DESKTOP_LOCAL_BACKEND_MODE: process.env.NEXT_PUBLIC_KERA_DESKTOP_LOCAL_BACKEND_MODE || "managed",
    NEXT_PUBLIC_KERA_DESKTOP_ML_TRANSPORT: process.env.NEXT_PUBLIC_KERA_DESKTOP_ML_TRANSPORT || "sidecar",
    NEXT_PUBLIC_KERA_DESKTOP_STRICT_MODE:
      process.env.NEXT_PUBLIC_KERA_DESKTOP_STRICT_MODE || process.env.KERA_DESKTOP_STRICT_MODE || "0",
    NEXT_PUBLIC_KERA_CONTROL_PLANE_API_BASE_URL:
      process.env.NEXT_PUBLIC_KERA_CONTROL_PLANE_API_BASE_URL || "https://k-era.org/control-plane/api",
  };
  return {
    "process.env": JSON.stringify(entries),
  };
}

function desktopShellJsBuildOptions(rootDir, { onEnd } = {}) {
  const paths = desktopShellPaths(rootDir);
  const plugins = [];

  plugins.push({
    name: "desktop-next-adapters",
    setup(build) {
      build.onResolve({ filter: /^next\/image$/ }, () => ({
        path: path.join(rootDir, "desktop-shell", "adapters", "next-image.tsx"),
      }));
      build.onResolve({ filter: /^next\/script$/ }, () => ({
        path: path.join(rootDir, "desktop-shell", "adapters", "next-script.tsx"),
      }));
    },
  });

  if (typeof onEnd === "function") {
    plugins.push({
      name: "desktop-shell-build-notifier",
      setup(build) {
        build.onEnd((result) => {
          onEnd(result);
        });
      },
    });
  }

  return {
    absWorkingDir: rootDir,
    entryPoints: ["desktop-shell/main.tsx"],
    bundle: true,
    format: "esm",
    target: "es2022",
    outfile: path.join(paths.outAssetsDir, "desktop-shell.js"),
    define: buildClientEnv(),
    jsx: "automatic",
    sourcemap: process.env.NODE_ENV !== "production",
    minify: process.env.NODE_ENV === "production",
    plugins,
  };
}

export async function resetDesktopShellOutput(rootDir = process.cwd()) {
  const paths = desktopShellPaths(rootDir);
  await fs.rm(paths.outDir, { recursive: true, force: true });
  await fs.mkdir(paths.outAssetsDir, { recursive: true });
}

export async function buildDesktopShellCss(rootDir = process.cwd()) {
  const paths = desktopShellPaths(rootDir);
  const sourcePath = path.join(rootDir, "desktop-shell", "desktop.css");
  const source = await fs.readFile(sourcePath, "utf8");
  const plugins = await loadPostCssPlugins();
  const result = await postcss(plugins).process(source, { from: sourcePath });
  await fs.mkdir(paths.outAssetsDir, { recursive: true });
  await fs.writeFile(path.join(paths.outAssetsDir, "desktop-shell.css"), result.css, "utf8");
}

export async function buildDesktopShellJs(rootDir = process.cwd()) {
  const paths = desktopShellPaths(rootDir);
  await fs.mkdir(paths.outAssetsDir, { recursive: true });
  await esbuild.build(desktopShellJsBuildOptions(rootDir));
}

export async function createDesktopShellJsWatcher(rootDir = process.cwd(), { onEnd } = {}) {
  const paths = desktopShellPaths(rootDir);
  await fs.mkdir(paths.outAssetsDir, { recursive: true });
  const context = await esbuild.context(desktopShellJsBuildOptions(rootDir, { onEnd }));
  await context.rebuild();
  await context.watch();
  return context;
}

export async function buildDesktopShellHtml(rootDir = process.cwd()) {
  const { outDir } = desktopShellPaths(rootDir);
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>K-ERA Desktop</title>
    <link rel="stylesheet" href="./assets/desktop-shell.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./assets/desktop-shell.js"></script>
  </body>
</html>
`;
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(path.join(outDir, "index.html"), html, "utf8");
}

export async function copyDesktopShellStaticAssets(rootDir = process.cwd()) {
  const { outDir } = desktopShellPaths(rootDir);
  const sourceDir = path.join(rootDir, "public", "landing");
  const targetDir = path.join(outDir, "landing");
  await fs.rm(targetDir, { recursive: true, force: true });
  await copyDirectory(sourceDir, targetDir);
}

export async function buildDesktopShell(rootDir = process.cwd()) {
  await resetDesktopShellOutput(rootDir);
  await Promise.all([
    buildDesktopShellCss(rootDir),
    buildDesktopShellJs(rootDir),
    copyDesktopShellStaticAssets(rootDir),
  ]);
  await buildDesktopShellHtml(rootDir);
}
