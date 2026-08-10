"use client";

import { useState } from "react";
import { CDN_BASE } from "@/utils/constants";

/**
 * Token art from the ecosystem CDN (which ingests our CIP-25 metadata), with
 * a monogram fallback. `large` renders (the hero art on a launch's own page)
 * go through /art/<ASSET>, which resolves CDN-vs-our-own-hosted server-side —
 * cdn.xcp.io serves a 200 placeholder (not a 404) for anything it hasn't
 * crawled yet, marked by a header that's invisible to client JS on a
 * cross-origin fetch, so only the server can tell the difference. Small
 * icons skip that check (cheap, high-volume — list rows, not a hero) and
 * fall straight from the CDN icon to our hosted original on a real 404.
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
    ? [`/art/${asset}`]
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

  if (index >= sources.length) {
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
