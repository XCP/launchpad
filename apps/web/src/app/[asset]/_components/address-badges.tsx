import { CHIP, CollectionChip } from "@/components/collection-chip";
import { COLLECTIONS } from "@/lib/collections";
import { BURN_ADDRESS } from "@/lib/inscriber/constants";


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
        <CollectionChip key={c.tag} collection={c} />
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
