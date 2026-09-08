"use client";

import { CHIP, CollectionChip } from "@/components/collection-chip";
import { useT } from "@/lib/i18n/client";
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
  maxChips = 6,
}: {
  address: string;
  issuerSource?: string;
  collections?: string[];
  /** Collection flair slots, including the overflow count; identity badges remain separate. */
  maxChips?: number;
}) {
  const t = useT();
  return (
    <>
      <DevBadge address={address} issuerSource={issuerSource} />
      {address === BURN_ADDRESS && (
        <span
          className={`${CHIP} border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-800 dark:bg-orange-950/40 dark:text-orange-300`}
          title={t("Counterparty's canonical unspendable burn address")}
        >
          <span aria-hidden="true">🔥</span>
          <span className="sr-only">{t("burn address")}</span>
        </span>
      )}
      {collections && <CollectionChips tags={collections} maxChips={maxChips} />}
    </>
  );
}

/** Reserve the final slot for a count when the row exceeds its limit.
 *  The count's tooltip names every remaining collection. */
function CollectionChips({ tags, maxChips }: { tags: string[]; maxChips: number }) {
  const t = useT();
  const matched = COLLECTIONS.filter((c) => tags.includes(c.tag));
  const shown = matched.length <= maxChips ? matched : matched.slice(0, maxChips - 1);
  const rest = matched.slice(shown.length);
  return (
    <>
      {shown.map((c) => (
        <CollectionChip key={c.tag} collection={c} />
      ))}
      {rest.length > 0 && (
        <span
          className={`${CHIP} border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300`}
          title={t("Also created: {names}", { names: rest.map((c) => c.name).join(", ") })}
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
  const t = useT();
  if (issuerSource !== address) return null;
  return (
    <span
      className={`${CHIP} border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-800 dark:bg-purple-950/40 dark:text-purple-300`}
      title={t("Launched this token")}
    >
      {t("dev")}
    </span>
  );
}
