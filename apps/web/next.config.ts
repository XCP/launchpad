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
  /**
   * One canonical origin.
   *
   * The worker answers on both xcp.fun and launchpad.me-bbe.workers.dev, and
   * people do end up on the second one — a creator was signing against it
   * without realising. That split matters beyond tidiness: a wallet
   * connection proof is bound to the origin that requested it, so a session
   * started on one host and continued on the other has a proof that cannot
   * validate. Same site, two identities.
   *
   * 308 rather than a temporary redirect: the method is preserved, and this
   * is a permanent statement about which host is the real one. Any path and
   * query ride along, so a shared workers.dev link still lands where it meant
   * to.
   */
  async redirects() {
    const fromWorkersDev = [
      { type: "host" as const, value: "launchpad.me-bbe.workers.dev" },
    ];
    return [
      // Two rules, not one. `/:path*` matches zero segments as well, and with
      // an ABSOLUTE destination Next has nothing to substitute for the empty
      // match — the bare root redirected to the literal `https://xcp.fun/:path*`.
      // `/:path+` requires at least one segment; the root gets its own rule.
      {
        source: "/",
        has: fromWorkersDev,
        destination: "https://xcp.fun/",
        permanent: true,
      },
      {
        source: "/:path+",
        has: fromWorkersDev,
        destination: "https://xcp.fun/:path+",
        permanent: true,
      },
    ];
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
