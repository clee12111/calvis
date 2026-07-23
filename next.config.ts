import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite uses WASM that can't be bundled by Turbopack — keep it external
  serverExternalPackages: ["@electric-sql/pglite"],
};

export default nextConfig;
