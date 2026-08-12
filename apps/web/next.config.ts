import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// Makes wrangler-simulated bindings (R2) available in `next dev`.
void initOpenNextCloudflareForDev();

const nextConfig: NextConfig = {
  reactCompiler: true,
  /**
   * How long a page may be served STALE after its revalidate window closes.
   *
   * Next's default is a year, which arrived as `stale-while-revalidate=2592000`
   * — thirty days. That is the mechanism behind "I deployed and the site looks
   * unchanged": past the freshness window a browser is entitled to hand back
   * the copy it already has and fetch the new one behind your back, so the
   * first load after any deploy shows the old page and the reload shows the
   * new one. It reads exactly like a failed deploy.
   *
   * Five minutes keeps what stale-while-revalidate is actually for — riding
   * out a slow or unreachable origin without showing anyone an error — while
   * making "stale" mean minutes instead of a month. Per the config docs the
   * header value is expire minus the path's own revalidate, so the homepage
   * (revalidate 30) lands at s-maxage=30, stale-while-revalidate=270.
   */
  expireTime: 300,
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
