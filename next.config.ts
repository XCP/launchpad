import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// Makes wrangler-simulated bindings (R2) available in `next dev`.
void initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {
  reactCompiler: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "cdn.xcp.io" },
    ],
  },
  // Clean metadata URLs. /j and /i remain permanent aliases — LAUNCHCOIN's
  // on-chain description points at /j/, and descriptions lock forever.
  async rewrites() {
    return [
      { source: "/:asset([A-Z0-9]+)\\.json", destination: "/j/:asset.json" },
      { source: "/full/:asset", destination: "/i/:asset" },
    ];
  },
};

export default nextConfig;
