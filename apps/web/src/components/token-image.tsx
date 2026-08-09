"use client";

import { useState } from "react";

/**
 * Token art from the ecosystem CDN (which ingests our CIP-25 metadata), with
 * a monogram fallback. The /i host exists for ingestion, not for display —
 * but for `large` renders it beats an upscaled icon, so it sits in the
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
    ? [
        `https://cdn.xcp.io/img/full/${asset}`,
        `/i/${asset}`,
        `https://cdn.xcp.io/img/icon/${asset}`,
      ]
    : [`https://cdn.xcp.io/img/icon/${asset}`];
  const [index, setIndex] = useState(0);

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
