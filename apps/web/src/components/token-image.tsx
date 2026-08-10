"use client";

import { useState } from "react";
import { CDN_BASE } from "@/utils/constants";

function Monogram({ asset, large, className }: { asset: string; large: boolean; className: string }) {
  return (
    <div
      aria-hidden
      className={`flex items-center justify-center bg-gray-200 font-bold text-gray-500 ${
        large ? "text-5xl" : ""
      } ${className}`}
    >
      {asset.slice(0, 1)}
    </div>
  );
}

/**
 * Token art from the ecosystem CDN (which ingests our CIP-25 metadata), with
 * a monogram fallback. `large` picks the starting fallback tier and monogram
 * size — for `large` renders it beats an upscaled icon, so it sits in the
 * fallback chain: CDN full-size → our hosted original → CDN icon → monogram.
 */
export function TokenImage({
  asset,
  className = "",
  large = false,
}: {
  asset: string;
  className?: string;
  large?: boolean;
}) {
  const sources = large
    ? [`${CDN_BASE}/img/full/${asset}`, `/i/${asset}`, `${CDN_BASE}/img/icon/${asset}`]
    : [`${CDN_BASE}/img/icon/${asset}`, `/i/${asset}`];

  // Reset the fallback chain when the identity this component is showing
  // changes — TokenImage instances can be reused across a different asset
  // in a list without remounting.
  const [key, setKey] = useState(`${asset}:${large}`);
  const [index, setIndex] = useState(0);
  if (key !== `${asset}:${large}`) {
    setKey(`${asset}:${large}`);
    setIndex(0);
  }

  if (index >= sources.length) return <Monogram asset={asset} large={large} className={className} />;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- fallback chain needs onError
    <img
      src={sources[index]}
      alt=""
      className={className}
      onError={() => setIndex((i) => i + 1)}
    />
  );
}

/**
 * The one hero image per launch page — the only place worth the extra
 * Worker round-trip in /art/<ASSET>, which resolves CDN-vs-our-own-hosted
 * server-side. cdn.xcp.io serves a 200 placeholder (not a 404) for anything
 * it hasn't crawled yet, marked by a header client JS can't read on a
 * cross-origin fetch — only the server can tell a placeholder from real art.
 * Everywhere else (grid cards, list rows, preview mockups) stays on
 * TokenImage's plain client-side chain; that traffic is too high-volume to
 * route through our Worker for a check that only matters once per page.
 */
export function HeroTokenImage({ asset, className = "" }: { asset: string; className?: string }) {
  const [key, setKey] = useState(asset);
  const [failed, setFailed] = useState(false);
  if (key !== asset) {
    setKey(asset);
    setFailed(false);
  }

  if (failed) return <Monogram asset={asset} large className={className} />;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- needs onError for the monogram fallback
    <img src={`/art/${asset}`} alt="" className={className} onError={() => setFailed(true)} />
  );
}
