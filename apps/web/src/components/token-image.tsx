"use client";

import { useEffect, useRef, useState } from "react";
import { CDN_BASE } from "@/lib/constants";

/**
 * Advance the fallback chain for a failure that happened BEFORE hydration.
 *
 * These images are server-rendered, so the browser starts fetching them while
 * parsing the HTML — long before React attaches an onError handler. When the
 * first source 404s in that window the error event has already come and gone,
 * nothing advances the index, and the chain stops dead on a broken image. That
 * is exactly what the XCP and BTC chips did: `/i/XCP` is a 404 (we only host
 * art for launches), and the CDN icon behind it was never reached.
 *
 * A complete image with no intrinsic width is a failed image, and that state
 * survives the missed event — so it can be read once on mount instead.
 */
function useMissedError(ref: React.RefObject<HTMLImageElement | null>, onFailed: () => void) {
  useEffect(() => {
    const img = ref.current;
    if (img?.complete && img.naturalWidth === 0) onFailed();
  });
}

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
 * Token art, with a monogram fallback.
 *
 * OUR copy is asked for first, and that ordering is the whole point.
 * cdn.xcp.io answers 200 with a default placeholder image for anything it
 * hasn't crawled — not a 404 — and the header marking it as such isn't
 * CORS-exposed, so `onError` never fires and a CDN-first chain stops dead on
 * the placeholder without ever reaching the real art. Asking our own R2 first
 * sidesteps the ambiguity entirely — and on a miss the route 302s straight
 * to the CDN (`fb` names the size) instead of 404ing, so a page of chips for
 * assets we never hosted doesn't fill the console with errors on the way to
 * the same image.
 *
 * It is also the correct authority. Every launch created here uploads its art
 * to R2 at creation, before the CDN has ever seen the asset — so when both
 * have something, ours is the original and the CDN's is a copy at best.
 *
 * Chain: our original (redirecting to the CDN on miss) → CDN icon directly
 * (only if our Worker itself errors) → monogram.
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
    ? [`/i/${asset}?fb=full`, `${CDN_BASE}/img/full/${asset}`, `${CDN_BASE}/img/icon/${asset}`]
    : [`/i/${asset}?fb=icon`, `${CDN_BASE}/img/icon/${asset}`];

  // Reset the fallback chain when the identity this component is showing
  // changes — TokenImage instances can be reused across a different asset
  // in a list without remounting.
  const [key, setKey] = useState(`${asset}:${large}`);
  const [index, setIndex] = useState(0);
  if (key !== `${asset}:${large}`) {
    setKey(`${asset}:${large}`);
    setIndex(0);
  }

  const ref = useRef<HTMLImageElement>(null);
  const advance = () => setIndex((i) => i + 1);
  useMissedError(ref, advance);

  if (index >= sources.length) return <Monogram asset={asset} large={large} className={className} />;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- fallback chain needs onError
    <img
      ref={ref}
      src={sources[index]}
      alt=""
      className={className}
      onError={advance}
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

  const ref = useRef<HTMLImageElement>(null);
  useMissedError(ref, () => setFailed(true));

  if (failed) return <Monogram asset={asset} large className={className} />;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- needs onError for the monogram fallback
    <img
      ref={ref}
      src={`/art/${asset}`}
      alt=""
      className={className}
      onError={() => setFailed(true)}
    />
  );
}
