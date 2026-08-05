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
};

export default nextConfig;
