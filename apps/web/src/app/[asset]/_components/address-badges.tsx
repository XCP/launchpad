import { BURN_ADDRESS } from "@/lib/inscriber/constants";

const CHIP = "shrink-0 rounded-full border px-1.5 py-px text-[10px] font-medium";

/** Chip colours by Tailwind family; full class strings so the scanner sees them. */
const TONE = {
  red: "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300",
  orange: "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-300",
  amber: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
  yellow: "border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300",
  lime: "border-lime-200 bg-lime-50 text-lime-700 dark:border-lime-800 dark:bg-lime-950/40 dark:text-lime-300",
  green: "border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/40 dark:text-green-300",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300",
  teal: "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-300",
  cyan: "border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-300",
  sky: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300",
  blue: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300",
  indigo: "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300",
  violet: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-300",
  purple: "border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-800 dark:bg-purple-950/40 dark:text-purple-300",
  fuchsia: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700 dark:border-fuchsia-800 dark:bg-fuchsia-950/40 dark:text-fuchsia-300",
  pink: "border-pink-200 bg-pink-50 text-pink-700 dark:border-pink-800 dark:bg-pink-950/40 dark:text-pink-300",
  rose: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300",
  slate: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300",
  zinc: "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300",
  stone: "border-stone-200 bg-stone-50 text-stone-700 dark:border-stone-700 dark:bg-stone-800/60 dark:text-stone-300",
} as const;

/**
 * One chip per curated collection, keyed by the explorer's tag. Emoji only,
 * the collection's name in the tooltip: an address can carry several and
 * words would not fit. Colour follows the collection's own card art where it
 * has a colour of its own; the emoji carries the identity where it does not.
 */
const COLLECTIONS: { tag: string; emoji: string; name: string; tone: keyof typeof TONE }[] = [
  { tag: "kaleidoscope", emoji: "🔭", name: "Kaleidoscope card", tone: "indigo" },
  { tag: "dank-directory", emoji: "🌿", name: "Dank Rare", tone: "red" },
  { tag: "fake-commons", emoji: "🃏", name: "Fake Common", tone: "emerald" },
  { tag: "fake-rare", emoji: "🎩", name: "Fake Rare", tone: "pink" },
  { tag: "bitcorn", emoji: "🌽", name: "Bitcorn", tone: "yellow" },
  { tag: "the-pepe-project", emoji: "🗽", name: "Pepe Project card", tone: "red" },
  { tag: "faux-bitcorn", emoji: "🍿", name: "Faux Bitcorn", tone: "amber" },
  { tag: "rare-coco", emoji: "🐊", name: "Rare Coco", tone: "teal" },
  { tag: "rare-ordinal-directory", emoji: "🟠", name: "Rare Ordinal", tone: "orange" },
  { tag: "rare-pigeons", emoji: "🐦", name: "Rare Pigeon", tone: "slate" },
  { tag: "lfg-collection", emoji: "🚀", name: "LFG Collection card", tone: "rose" },
  { tag: "the-wojak-way", emoji: "😐", name: "Wojak Way card", tone: "pink" },
  { tag: "rarepenpen", emoji: "🐧", name: "RarePenPen", tone: "sky" },
  { tag: "bassmint", emoji: "🐟", name: "Bassmint card", tone: "orange" },
  { tag: "common-coco", emoji: "🥥", name: "Common Coco", tone: "cyan" },
  { tag: "rare-gogo", emoji: "🐐", name: "Rare GoGo", tone: "rose" },
  { tag: "the-greypepe-project", emoji: "🩶", name: "GreyPepe", tone: "zinc" },
  { tag: "barnyard-club", emoji: "🐷", name: "Barnyard Club card", tone: "red" },
  { tag: "mafia-wars", emoji: "🔫", name: "Mafia Wars card", tone: "stone" },
  { tag: "rare-pepe", emoji: "🐸", name: "Rare Pepe", tone: "green" },
  { tag: "scannable-nfts", emoji: "🔳", name: "Scannable NFT", tone: "fuchsia" },
  { tag: "unatrare", emoji: "🦄", name: "UNATRARE card", tone: "violet" },
  { tag: "fake-ape-club", emoji: "🦧", name: "Fake Ape", tone: "blue" },
  { tag: "retroxcp", emoji: "👾", name: "RetroXCP card", tone: "blue" },
  { tag: "17art", emoji: "🎨", name: "17ART card", tone: "red" },
  { tag: "assetic", emoji: "🍑", name: "Assetic card", tone: "orange" },
  { tag: "drooling-ape-bus-club", emoji: "🚌", name: "Drooling Ape", tone: "lime" },
  { tag: "faux-sogs", emoji: "🔮", name: "Faux SOG", tone: "cyan" },
  { tag: "phockheads", emoji: "🗿", name: "Phockhead", tone: "purple" },
  { tag: "rare-shadilay", emoji: "🌀", name: "Rare Shadilay", tone: "blue" },
  { tag: "raresocks", emoji: "🧦", name: "RareSock", tone: "violet" },
  { tag: "comedianas", emoji: "🎭", name: "Comedianas card", tone: "stone" },
  { tag: "cubism-nakamoto", emoji: "🧊", name: "Cubism Nakamoto card", tone: "orange" },
  { tag: "fake-munchkin", emoji: "🎲", name: "Fake Munchkin", tone: "amber" },
  { tag: "memorychain", emoji: "🎌", name: "MemoryChain card", tone: "lime" },
  { tag: "notable-pepe", emoji: "📝", name: "Notable Pepe", tone: "rose" },
  { tag: "oasis-mining", emoji: "⛏️", name: "Oasis Mining card", tone: "amber" },
  { tag: "pepe-vote", emoji: "🗳️", name: "Pepe Vote card", tone: "teal" },
  { tag: "phunchkins", emoji: "😾", name: "Phunchkin", tone: "orange" },
  { tag: "rare-bobo", emoji: "🐻", name: "Rare Bobo", tone: "orange" },
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
      {collections && <CollectionChips tags={collections} />}
    </>
  );
}

/** Six chips fit a row; past that, five and a count, so a prolific creator
 *  never pushes the balance off the screen. The count's tooltip names the rest. */
const SHOW_ALL_UP_TO = 6;
const SHOW_WHEN_MORE = 5;

function CollectionChips({ tags }: { tags: string[] }) {
  const matched = COLLECTIONS.filter((c) => tags.includes(c.tag));
  const shown = matched.length <= SHOW_ALL_UP_TO ? matched : matched.slice(0, SHOW_WHEN_MORE);
  const rest = matched.slice(shown.length);
  return (
    <>
      {shown.map((c) => (
        <span key={c.tag} className={`${CHIP} ${TONE[c.tone]}`} title={`Created a ${c.name}`}>
          <span aria-hidden="true">{c.emoji}</span>
          <span className="sr-only">{c.name} creator</span>
        </span>
      ))}
      {rest.length > 0 && (
        <span
          className={`${CHIP} border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300`}
          title={`Also created: ${rest.map((c) => c.name).join(", ")}`}
        >
          +{rest.length}
        </span>
      )}
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
