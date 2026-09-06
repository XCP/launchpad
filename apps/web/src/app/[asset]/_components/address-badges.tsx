import { useEffect, useState } from "react";
import { BURN_ADDRESS } from "@/lib/inscriber/constants";

const CHIP = "shrink-0 rounded-full border px-1.5 py-px text-[10px] font-medium";

type Creators = typeof import("@/lib/collection-creators");

/** One collection badge: which creator set, what to show, what it means. */
const COLLECTIONS: {
  set: keyof Creators;
  emoji: string;
  label: string;
  title: string;
  className: string;
}[] = [
  {
    set: "RARE_PEPE_CREATORS",
    emoji: "🐸",
    label: "Rare Pepe creator",
    title: "Created a Rare Pepe",
    className:
      "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/40 dark:text-green-400",
  },
  {
    set: "BITCORN_CREATORS",
    emoji: "🌽",
    label: "Bitcorn creator",
    title: "Created a Bitcorn",
    className:
      "border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-400",
  },
  {
    set: "FAKE_RARE_CREATORS",
    emoji: "🎩",
    label: "Fake Rare creator",
    title: "Created a Fake Rare",
    className:
      "border-pink-200 bg-pink-50 text-pink-700 dark:border-pink-800 dark:bg-pink-950/40 dark:text-pink-300",
  },
  {
    set: "DANK_RARE_CREATORS",
    emoji: "🐸",
    label: "Dank Rare creator",
    title: "Created a Dank Rare",
    className:
      "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
  },
  {
    set: "RARE_COCO_CREATORS",
    emoji: "🐊",
    label: "Rare Coco creator",
    title: "Created a Rare Coco",
    className:
      "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-300",
  },
  {
    set: "RARE_PIGEON_CREATORS",
    emoji: "🐦",
    label: "Rare Pigeon creator",
    title: "Created a Rare Pigeon",
    className:
      "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300",
  },
  {
    set: "KALEIDOSCOPE_CREATORS",
    emoji: "🔭",
    label: "Kaleidoscope creator",
    title: "Created a Kaleidoscope card",
    className:
      "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300",
  },
];

// The creator sets are ~32 KB gzipped — a separate chunk, fetched once per
// browser after the first list that needs it renders, never before. Every
// badge on the page shares the one load.
let creatorsPromise: Promise<Creators> | null = null;
let creatorsLoaded: Creators | null = null;
function useCollectionCreators(): Creators | null {
  const [creators, setCreators] = useState<Creators | null>(creatorsLoaded);
  useEffect(() => {
    if (creatorsLoaded) return;
    creatorsPromise ??= import("@/lib/collection-creators");
    let live = true;
    creatorsPromise.then((m) => {
      creatorsLoaded = m;
      if (live) setCreators(m);
    });
    return () => {
      live = false;
    };
  }, []);
  return creators;
}

/**
 * Who an address is, next to it in the launch page's minter and holder
 * lists: the launch's own dev, the burn address, and the creators of the
 * Counterparty collections above. Rendered as siblings of the address link,
 * never inside it — an ancestor's underline paints through descendant text,
 * so the only way to keep a chip clean is to keep it out of the <a>. The
 * tooltip carries the words the chip leaves out.
 */
export function AddressBadges({ address, issuerSource }: { address: string; issuerSource?: string }) {
  const creators = useCollectionCreators();
  return (
    <>
      <DevBadge address={address} issuerSource={issuerSource} />
      {address === BURN_ADDRESS && (
        <span
          className={`${CHIP} border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-300`}
          title="Counterparty's canonical unspendable burn address"
        >
          <span aria-hidden="true">🔥</span>
          <span className="sr-only">burn address</span>
        </span>
      )}
      {creators &&
        COLLECTIONS.filter((c) => creators[c.set].has(address)).map((c) => (
          <span key={c.set} className={`${CHIP} ${c.className}`} title={c.title}>
            <span aria-hidden="true">{c.emoji}</span>
            <span className="sr-only">{c.label}</span>
          </span>
        ))}
    </>
  );
}

/** The launch's own creator. On the trades and orders tapes this is the only
 *  chip that matters — who someone is elsewhere on Counterparty says nothing
 *  about a fill — so those tables render just this, not the full set. */
export function DevBadge({ address, issuerSource }: { address: string; issuerSource?: string }) {
  if (issuerSource !== address) return null;
  return (
    <span
      className={`${CHIP} border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-800 dark:bg-purple-950/40 dark:text-purple-300`}
      title="Launched this token"
    >
      dev
    </span>
  );
}
