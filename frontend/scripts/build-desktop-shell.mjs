import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import * as esbuild from "esbuild";
import postcss from "postcss";

import postcssConfig from "../postcss.config.mjs";

const repoRoot = process.cwd();
const outDir = path.join(repoRoot, "desktop-dist");
const outAssetsDir = path.join(outDir, "assets");

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
    NEXT_PUBLIC_KERA_DESKTOP_LOCAL_BACKEND_MODE: process.env.NEXT_PUBLIC_KERA_DESKTOP_LOCAL_BACKEND_MODE || "managed",
    NEXT_PUBLIC_KERA_DESKTOP_ML_TRANSPORT: process.env.NEXT_PUBLIC_KERA_DESKTOP_ML_TRANSPORT || "sidecar",
    NEXT_PUBLIC_KERA_CONTROL_PLANE_API_BASE_URL: process.env.NEXT_PUBLIC_KERA_CONTROL_PLANE_API_BASE_URL || "https://kera-bay.vercel.app/control-plane/api",
  };
  return {
    "process.env": JSON.stringify(entries),
  };
}

async function buildCss() {
  const sourcePath = path.join(repoRoot, "desktop-shell", "desktop.css");
  const source = await fs.readFile(sourcePath, "utf8");
  const plugins = await loadPostCssPlugins();
  const result = await postcss(plugins).process(source, { from: sourcePath });
  await fs.writeFile(path.join(outAssetsDir, "desktop-shell.css"), result.css, "utf8");
}

async function buildJs() {
  await esbuild.build({
    absWorkingDir: repoRoot,
    entryPoints: ["desktop-shell/main.tsx"],
    bundle: true,
    format: "esm",
    target: "es2022",
    outfile: path.join(outAssetsDir, "desktop-shell.js"),
    define: buildClientEnv(),
    jsx: "automatic",
    sourcemap: process.env.NODE_ENV !== "production",
    minify: process.env.NODE_ENV === "production",
  });
}

async function buildHtml() {
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
  await fs.writeFile(path.join(outDir, "index.html"), html, "utf8");
}

async function copyStaticAssets() {
  await copyDirectory(path.join(repoRoot, "public", "landing"), path.join(outDir, "landing"));
}

await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outAssetsDir, { recursive: true });
await Promise.all([buildCss(), buildJs(), copyStaticAssets()]);
await buildHtml();
