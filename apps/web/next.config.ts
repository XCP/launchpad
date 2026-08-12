import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// Makes wrangler-simulated bindings (R2) available in `next dev`.
void initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {
  reactCompiler: true,
  // NOTE: `expireTime` does nothing on this deployment target — see the note
  // in open-next.config.ts. It was tried here first, and it is inert.
  // The XCP-69 predicate is shared with apps/api so the two never derive
  // different verdicts; Next doesn't transpile workspace packages by default.
  transpilePackages: ["@launchpad/xcp69"],
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
