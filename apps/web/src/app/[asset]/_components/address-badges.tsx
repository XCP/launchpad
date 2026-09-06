import { BURN_ADDRESS } from "@/lib/inscriber/constants";
import { BITCORN_CREATORS, RARE_PEPE_CREATORS } from "@/lib/collection-creators";

const CHIP = "shrink-0 rounded-full border px-1.5 py-px text-[10px] font-medium";

/**
 * Who an address is, next to it in the launch page's lists: the launch's own
 * dev, the burn address, and the creators of two closed Counterparty series.
 * Rendered as siblings of the address link, never inside it — an ancestor's
 * underline paints through descendant text, so the only way to keep a chip
 * clean is to keep it out of the <a>. The tooltip carries the words the chip
 * leaves out.
 */
export function AddressBadges({ address, issuerSource }: { address: string; issuerSource?: string }) {
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
      {RARE_PEPE_CREATORS.has(address) && (
        <span
          className={`${CHIP} border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/40 dark:text-green-400`}
          title="Created a Rare Pepe"
        >
          <span aria-hidden="true">🐸</span>
          <span className="sr-only">Rare Pepe creator</span>
        </span>
      )}
      {BITCORN_CREATORS.has(address) && (
        <span
          className={`${CHIP} border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-400`}
          title="Created a Bitcorn"
        >
          <span aria-hidden="true">🌽</span>
          <span className="sr-only">Bitcorn creator</span>
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
