import { approx, big, minRaw, SATS, SATS_PER_UNIT, type RawLike } from "./numeric";

/**
 * The XCP dispenser book as a price source.
 *
 * XCP has no exchange listing anyone here actually deals on. The explorer's
 * ticker derives its mark from a thin XCP/BTC feed, and it drifts far from the
 * only venue this project's users can buy XCP at: the dispenser book, which is
 * where /dispense sends them. When the two disagree — $1.82 on the ticker
 * against a $2.77 best ask as this was written — every dollar figure the
 * project prints quotes a price no visitor can transact at, and someone who
 * just paid the ask sees their own holdings marked a third below what they
 * cost.
 *
 * So the ask is the mark. It lives here, in the shared package, because three
 * surfaces read it — the site's sitewide XCP/USD, the Floor button on
 * /dispense, and the API worker's Telegram alerts — and a price the site
 * prints, a price a button sets, and a price an alert quotes cannot be allowed
 * to drift into three definitions of "cheapest".
 */

/** The three integers a dispenser's ask is defined by. Deliberately narrower
 *  than either app's full `Dispenser` row so both can pass theirs in. */
export interface DispenserAsk {
  give_quantity: RawLike;
  give_remaining: RawLike;
  satoshirate: RawLike;
}

/**
 * Sats per whole XCP for one dispenser, derived from the two raw integers it
 * is actually defined by rather than from the API's pre-divided `price`.
 *
 * `satoshirate` is what a vend costs and `give_quantity` is what it gives, so
 * this is the quotient of two exact quantities. Taking `price` instead would
 * mean accepting a division someone else already did in a double, and then
 * rounding it again here.
 */
export function perXcpSats(r: DispenserAsk): bigint {
  const give = big(r.give_quantity);
  if (give <= 0n) return 0n;
  return (big(r.satoshirate) * SATS_PER_UNIT) / give;
}

/**
 * Whether this row is an ask anyone can actually hit.
 *
 * A dispenser vends in whole `give_quantity` lots — escrow short of one full
 * lot cannot vend at all, so it is not a price, it is a leftover. Excluding it
 * matters most at the head of the book, which is exactly where both the mark
 * and the undercut target are read from.
 */
function vendable(r: DispenserAsk): boolean {
  const give = big(r.give_quantity);
  return give > 0n && big(r.give_remaining) >= give && perXcpSats(r) > 0n;
}

/**
 * The cheapest price anyone can actually deal at, in sats per XCP.
 *
 * Computed with a min over the whole list rather than taken from its head. The
 * feed arrives sorted price-ascending, but a rule that leans on someone else's
 * sort breaks silently the day it changes, and this one decides what a user is
 * shown and what a button sets.
 *
 * Null when nothing is vendable, which is the honest answer: with no book
 * there is no floor, and every caller hides its comparison or falls back
 * rather than inventing one.
 */
export function bestAskSats(rows: DispenserAsk[]): number | null {
  const live = rows.filter(vendable);
  if (live.length === 0) return null;
  const cheapest = live.reduce((lo, r) => minRaw(lo, perXcpSats(r)), perXcpSats(live[0]));
  return approx(cheapest);
}

/**
 * The best ask in dollars. Needs BTC/USD because a dispenser quotes in sats
 * and nothing on the Counterparty side of the trade is denominated in fiat —
 * the dollar figure is a conversion of a BTC price, not a price of its own.
 */
export function bestAskUsd(rows: DispenserAsk[], btcUsd: number | null): number | null {
  if (!btcUsd || btcUsd <= 0) return null;
  const sats = bestAskSats(rows);
  if (sats === null || sats <= 0) return null;
  const usd = (sats / SATS) * btcUsd;
  return usd > 0 ? usd : null;
}
