import { BURN_ADDRESS } from "@/lib/inscriber/constants";

const CHIP = "shrink-0 rounded-full border px-1.5 py-px text-[10px] font-medium";

/** One collection badge, keyed by the explorer's collection tag: what to show and what it means. */
const COLLECTIONS: { tag: string; emoji: string; label: string; title: string; className: string }[] = [
  {
    tag: "rare-pepe",
    emoji: "🐸",
    label: "Rare Pepe creator",
    title: "Created a Rare Pepe",
    className:
      "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/40 dark:text-green-400",
  },
  {
    tag: "bitcorn",
    emoji: "🌽",
    label: "Bitcorn creator",
    title: "Created a Bitcorn",
    className:
      "border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-400",
  },
  {
    tag: "fake-rare",
    emoji: "🎩",
    label: "Fake Rare creator",
    title: "Created a Fake Rare",
    className:
      "border-pink-200 bg-pink-50 text-pink-700 dark:border-pink-800 dark:bg-pink-950/40 dark:text-pink-300",
  },
  {
    tag: "dank-directory",
    emoji: "🐸",
    label: "Dank Rare creator",
    title: "Created a Dank Rare",
    className:
      "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
  },
  {
    tag: "rare-coco",
    emoji: "🐊",
    label: "Rare Coco creator",
    title: "Created a Rare Coco",
    className:
      "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-300",
  },
  {
    tag: "rare-pigeons",
    emoji: "🐦",
    label: "Rare Pigeon creator",
    title: "Created a Rare Pigeon",
    className:
      "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300",
  },
  {
    tag: "kaleidoscope",
    emoji: "🔭",
    label: "Kaleidoscope creator",
    title: "Created a Kaleidoscope card",
    className:
      "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300",
  },
];

/**
 * Who an address is, next to it in the launch page's minter and holder
 * lists: the launch's own dev, the burn address, and the creators of the
 * Counterparty collections above. `collections` is the explorer's answer
 * for this address (see useAddressCollections) — the list's owner fetches
 * it once for the page and hands each row its tags. Rendered as siblings of
 * the address link, never inside it — an ancestor's underline paints
 * through descendant text, so the only way to keep a chip clean is to keep
 * it out of the <a>. The tooltip carries the words the chip leaves out.
 */
export function AddressBadges({
  address,
  issuerSource,
  collections,
}: {
  address: string;
  issuerSource?: string;
  collections?: string[];
}) {
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
      {collections &&
        COLLECTIONS.filter((c) => collections.includes(c.tag)).map((c) => (
          <span key={c.tag} className={`${CHIP} ${c.className}`} title={c.title}>
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
