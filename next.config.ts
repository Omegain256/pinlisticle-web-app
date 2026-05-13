import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  // Mark google-auth-library and its Node.js transitive deps as server-only.
  // They are require()'d at runtime on the server — never bundled into client chunks.
  serverExternalPackages: [
    "google-auth-library",
    "gaxios",
    "gtoken",
    "google-p12-pem",
    "node-fetch",
    "node-forge",
  ],
};

export default nextConfig;
