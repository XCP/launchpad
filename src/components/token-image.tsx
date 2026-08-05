"use client";

import { useState } from "react";

/**
 * Token art with a fallback chain: our own hosted image first (authoritative
 * for launches created here), then the ecosystem CDN, then a monogram.
 */
export function TokenImage({
  asset,
  className = "",
}: {
  asset: string;
  className?: string;
}) {
  const sources = [
    `/i/${asset}`,
    `https://cdn.xcp.io/img/icon/${asset}`,
  ];
  const [index, setIndex] = useState(0);

  if (index >= sources.length) {
    return (
      <div
        aria-hidden
        className={`flex items-center justify-center bg-gray-200 font-bold text-gray-500 ${className}`}
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
