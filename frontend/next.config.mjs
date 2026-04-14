import path from "node:path";
import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const internalApiBaseUrl =
  process.env.KERA_INTERNAL_API_BASE_URL?.replace(/\/$/, "") ??
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ??
  "http://127.0.0.1:8000";
const configDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig = {
  reactStrictMode: process.env.KERA_NEXT_STRICT_MODE?.trim() !== "0",
  allowedDevOrigins: ["http://localhost:3000", "http://127.0.0.1:3000"],
  outputFileTracingRoot: path.join(configDir, ".."),
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${internalApiBaseUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
