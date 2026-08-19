/**
 * What the channel actually says.
 *
 * Kept pure and separate from anything that sends: the wording and the size
 * bars are the product here, and they are the part worth having tests for.
 * Nothing in this file talks to Telegram, D1, or the clock.
 *
 * The genre this is leaning into is the buy-bot feed — a row of emoji whose
 * length IS the size, so the channel is readable as a shape at a glance and
 * only rewards reading if something looks big. That only works if the scale is
 * consistent, so every bar in here counts the same unit.
 */
import { formatExact, rawToDecimalString, big } from "@launchpad/xcp69/numeric";
import { XCP69, XCP69_EXACT } from "@launchpad/xcp69/xcp69";

/**
 * One XCP mints 100,000 tokens at the standard's fixed price, so 100k tokens
 * and 1 XCP are the same quantity said two ways. Sizing the bar per 100k
 * therefore means one emoji-pair per XCP, which is why the floor and the cap
 * below land on round XCP numbers rather than arbitrary token counts.
 */
const TOKENS_PER_EMOJI_PAIR = 100_000n;

/** Below this, nothing is announced. 10k tokens is a tenth of an XCP — small
 *  enough that it is dust, large enough that a real mint never trips it. */
export const MIN_TOKENS = 10_000n;

/**
 * A full bar is a maximum mint, by construction rather than by taste.
 *
 * The standard caps a single mint at MAX_MINT_PER_TX — 1,000,000 tokens, or
 * 10 XCP — so deriving the cap from it means the longest bar the feed can
 * produce for a mint is exactly the largest mint the chain can accept. Pick a
 * number by hand and it is either unreachable or hit early; this one cannot
 * drift from the standard because it IS the standard.
 */
const MINT_PAIR_CAP = Number(
  BigInt(XCP69.MAX_MINT_PER_TX) / 100_000_000n / TOKENS_PER_EMOJI_PAIR,
);

/** Trades have no protocol ceiling — supply is 100M, so a whale could produce
 *  a bar of any length. 60 emoji is a visual limit, not a meaningful one, and
 *  gives unusually large trades twice the room they previously had. */
const TRADE_PAIR_CAP = 30;

/** Mints are purple squares and trades are the market's own green and red
 *  circles. Two different shapes, not two shades of the same one: at a glance
 *  down the channel the question is "is this a mint or a trade", and 🟩 beside
 *  🟢 answers it too slowly. Purple is the site's accent. */
export const MINT_EMOJI = "🟪";
export const BUY_EMOJI = "🟢";
export const SELL_EMOJI = "🔴";
/** The wordmark's own emoji, so a graduation reads as the site celebrating. */
export const GRADUATE_EMOJI = "🎉";

/**
 * A launch being announced is the feed shouting, so it gets megaphones — and
 * more than a pair, because this is the one message that should catch an eye
 * scrolling past.
 *
 * The rocket is deliberately NOT here. It reads as "this is going up", which
 * on an announcement is a claim nobody has earned yet — the launch has not
 * even opened. It is saved for the graduation, where it is a statement of
 * something that actually happened.
 */
export const ANNOUNCE_EMOJI = "📣";
const ANNOUNCE_COUNT = 3;
export const LAUNCHED_EMOJI = "🚀";

/** Raw token units (8 decimals) to whole tokens. Amounts arrive as raw
 *  quantities everywhere in this repo; the bar is sized on whole tokens. */
const wholeTokens = (raw: bigint) => raw / 100_000_000n;

/**
 * The size bar. Two emoji per 100k whole tokens, at least one pair for
 * anything announced at all, capped so a whale does not produce a message
 * Telegram truncates.
 */
export function sizeBar(emoji: string, rawTokens: bigint, cap: number): string {
  const tokens = wholeTokens(rawTokens);
  const pairs = tokens / TOKENS_PER_EMOJI_PAIR;
  const clamped = pairs < 1n ? 1 : pairs > BigInt(cap) ? cap : Number(pairs);
  return emoji.repeat(clamped * 2);
}

/** Whole tokens, grouped, no decimals — 1,250,000 rather than 1250000.00. */
export function tokens(raw: bigint): string {
  return formatExact(rawToDecimalString(raw, 8), { maximumFractionDigits: 0 });
}

/** XCP to at most 2 decimals: raised totals are read, not transacted. */
export function xcp(raw: bigint): string {
  return formatExact(rawToDecimalString(raw, 8), { maximumFractionDigits: 2 });
}

/**
 * A TOKEN quantity said in XCP.
 *
 * soft_cap, hard_cap and earned_quantity are all counts of the token, not of
 * XCP — the standard's soft cap is 69,000,000 tokens. Printing those beside
 * the word XCP claimed a launch was raising 69 million XCP, which is more
 * than the asset's entire supply and read as plausible because the number had
 * a unit next to it.
 *
 * The conversion is exact and comes from the standard's own fixed price:
 * 1,000-token lots at 0.01 XCP, so 100,000 tokens is 1 XCP. Both sides are
 * 8-decimal raw, so this is a division by the lot ratio and nothing else.
 */
export function xcpOfTokens(tokenRaw: bigint): string {
  return xcp(tokenRaw / 100_000n);
}

/** ~10 minutes a block, said the way a person would say it. */
export function blocksEta(blocks: number): string {
  if (blocks <= 0) return "now";
  const minutes = blocks * 10;
  if (minutes < 60) return `~${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `~${hours}h`;
  return `~${Math.round(hours / 24)}d`;
}

const SITE = "https://xcp.fun";

/**
 * The ticker, bold and linked to its page.
 *
 * Linking the NAME rather than trailing a bare URL underneath: the name is
 * already the thing a reader looks for, and a naked link on its own line is a
 * second thing to skip past on every message in a feed that is mostly skimmed.
 * It also buys back a line, which matters on a phone.
 */
const assetLink = (asset: string) =>
  `<a href="${SITE}/${encodeURIComponent(asset)}"><b>${asset}</b></a>`;

/** A minter, linked to their profile. Shortened because the full address is
 *  35 characters of noise; linked because "who was that" is the obvious next
 *  question and the site can answer it. */
const addressLink = (addr: string) =>
  `<a href="${SITE}/profile/${encodeURIComponent(addr)}">${short(addr)}</a>`;

/**
 * The token's own artwork, which is what makes this a feed rather than a log.
 *
 * /full/<ASSET> is the metadata image the launch itself carries — the same one
 * the site and the on-chain description point at, so the channel shows what a
 * holder sees. Telegram fetches it by URL; a launch without artwork just
 * answers 404 and the caller falls back to a plain message.
 */
export const imageUrl = (asset: string) => `https://xcp.fun/full/${asset}`;

/**
 * A message and the picture to hang it on.
 *
 * Every announcement carries the token's image except the ones that are not
 * about one token — there is no artwork for "the queue got long".
 */
export interface Announcement {
  text: string;
  photo: string | null;
}

const withPhoto = (asset: string, text: string): Announcement => ({
  text,
  photo: imageUrl(asset),
});

export interface LaunchFacts {
  asset: string;
  startBlock: number;
  softCapRaw: bigint;
  hardCapRaw: bigint;
  height: number;
}

export function newLaunch(f: LaunchFacts): Announcement {
  const away = f.startBlock - f.height;
  const when =
    away > 0
      ? `Opens at block ${f.startBlock.toLocaleString("en-US")} (${blocksEta(away)})`
      : `Open now`;
  // No soft cap or supply line. Every XCP-69 launch has the same ones — 690
  // XCP and 100,000,000 tokens are in the standard, not in the launch — so
  // repeating them on every announcement is a constant dressed as news, and it
  // pushed the link down a line for nothing.
  return withPhoto(
    f.asset,
    [
      `${ANNOUNCE_EMOJI.repeat(ANNOUNCE_COUNT)} ${assetLink(f.asset)} announced`,
      when,
    ].join("\n"),
  );
}

export interface MintFacts {
  asset: string;
  earnedRaw: bigint;
  paidRaw: bigint;
  source: string;
  /** Progress toward the soft cap after this mint, 0–1, or null if uncapped. */
  progress: number | null;
}

export function mint(f: MintFacts): Announcement {
  // Progress on its own line. On the amounts line it pushed past the width a
  // phone shows and wrapped anyway, so the break is happening either way —
  // better to choose where it lands than to let Telegram choose.
  // The bar leads. It was moved to the end and moved back: trailing reads
  // better as a single message, but a channel is read as a column, and the
  // size is the thing worth spotting without stopping to read. Up top it
  // lines up down the left edge and the feed can be scanned by shape alone.
  const lines = [
    sizeBar(MINT_EMOJI, f.earnedRaw, MINT_PAIR_CAP),
    `${assetLink(f.asset)} minted`,
    `${tokens(f.earnedRaw)} tokens · ${xcp(f.paidRaw)} XCP`,
  ];
  if (f.progress !== null) {
    lines.push(`${Math.min(100, Math.round(f.progress * 100))}% to soft cap`);
  }
  lines.push(addressLink(f.source));
  return withPhoto(f.asset, lines.join("\n"));
}

/** A run of mints on one launch, collapsed because the queue got long. The
 *  bar is sized on the TOTAL so the shape still reads as the size of what
 *  happened, not the size of the last one. */
export function mintDigest(
  asset: string,
  count: number,
  earnedRaw: bigint,
  paidRaw: bigint,
): Announcement {
  return withPhoto(
    asset,
    [
      sizeBar(MINT_EMOJI, earnedRaw, MINT_PAIR_CAP),
      `${assetLink(asset)} · ${count} mints`,
      `${tokens(earnedRaw)} tokens · ${xcp(paidRaw)} XCP`,
    ].join("\n"),
  );
}

export function mintOpen(asset: string): Announcement {
  return withPhoto(asset, [`🔔 ${assetLink(asset)} is OPEN`, `Minting has started`].join("\n"));
}

export function mintClosing(
  asset: string,
  blocks: number,
  earnedRaw: bigint,
  softCapRaw: bigint,
): Announcement {
  const pct = softCapRaw > 0n ? ` · ${percent(earnedRaw, softCapRaw)}%` : "";
  return withPhoto(
    asset,
    [
      `⏳ ${assetLink(asset)} closes in ${blocks} block${blocks === 1 ? "" : "s"} (${blocksEta(blocks)})`,
      `${xcpOfTokens(earnedRaw)} / ${xcpOfTokens(softCapRaw)} XCP${pct}`,
    ].join("\n"),
  );
}

/**
 * The last stretch, when selling out stops being hypothetical.
 *
 * Fires once per launch, on the way past a progress mark. Live-only and never
 * replayed: half of what makes it worth reading is what is sitting in the
 * mempool right now, and there is no history of that — a mempool is only ever
 * the present. Replaying "90% minted, 4% pending" for a launch that closed
 * last week would be inventing a fact rather than recalling one.
 *
 * The pending share is what separates this from the countdown. At 90% minted
 * the question is not "is there time" but "is there any left", and unconfirmed
 * mints are the part of the answer no block explorer shows you yet.
 */
export function nearingSoldOut(
  asset: string,
  mintedPct: number,
  pendingPct: number,
): Announcement {
  // Every figure derived from the ones actually printed, so the three add to
  // 100. Deriving the remainder from the raw percentages instead lets rounding
  // put 90 + 4 + 5 on one line, and a reader who adds them up is not wrong to
  // conclude the bot cannot count.
  //
  // Minted floors and pending rounds, both deliberately: overstating how much
  // is gone discourages a mint that would still have landed, and understating
  // what is queued is the direction that costs someone a transaction.
  const minted = Math.floor(mintedPct);
  const pendingShown = pendingPct >= 1 ? Math.round(pendingPct) : 0;
  const open = Math.max(0, 100 - minted - pendingShown);
  return withPhoto(
    asset,
    [
      `🔥 ${assetLink(asset)} is ${minted}% minted`,
      pendingShown > 0
        ? `${pendingShown}% more is in the mempool · ${open}% still open`
        : `${open}% still open`,
    ].join("\n"),
  );
}

/**
 * One mark, at 90%.
 *
 * A ladder of them (75/90/95/99 was the first attempt) turns a rare signal
 * into a running commentary: four messages about one launch, each saying
 * roughly what the last one said, and the fourth arriving when there is
 * nothing left to act on anyway. Once is what makes it worth reading.
 *
 * Claimed as `near:<tx_hash>:90`, so a launch that hovers at 91% for a day
 * does not repeat it.
 */
export const NEAR_MARKS = [90] as const;

export interface CloseFacts {
  asset: string;
  graduated: boolean;
  earnedRaw: bigint;
  mints: number;
  minters: number;
}

/**
 * No size bar on either outcome, deliberately.
 *
 * A graduation raises 690 XCP, which on the mint scale would be 1,380 emoji —
 * and even capped it would be a wall that says nothing the number beside it
 * does not. The bar exists to make ONE event's size legible at a glance
 * against its neighbours; a launch closing is not that kind of event, it is
 * the end of hundreds of them. It gets the wordmark's own 🎉 instead.
 */
export function mintClosed(f: CloseFacts): Announcement {
  return withPhoto(
    f.asset,
    f.graduated
      ? [
          `${GRADUATE_EMOJI}${LAUNCHED_EMOJI} ${assetLink(f.asset)} GRADUATED ${LAUNCHED_EMOJI}${GRADUATE_EMOJI}`,
          `${xcpOfTokens(f.earnedRaw)} XCP raised`,
          `${f.minters} minters · ${f.mints} mints`,
          `Pool is live`,
        ].join("\n")
      : [
          `💔 ${assetLink(f.asset)} refunded`,
          `${xcpOfTokens(f.earnedRaw)} XCP raised · soft cap not met`,
          `Everyone is repaid`,
        ].join("\n"),
  );
}

export interface TradeFacts {
  asset: string;
  buy: boolean;
  tokenRaw: bigint;
  xcpRaw: bigint;
  venue: "pool" | "book";
  /** Current decorative conversion, never part of the on-chain trade math. */
  xcpUsd?: number | null;
  /** Causal Bitcoin transaction, when the indexed match exposes one. */
  txHash?: string | null;
  /** Trader whose indexed balance leg this alert represents. */
  address?: string | null;
}

export function trade(f: TradeFacts): Announcement {
  const priceRaw = f.tokenRaw > 0n ? (f.xcpRaw * 100_000_000n) / f.tokenRaw : 0n;
  // Every graduated XCP-69 asset has exactly 100M issued tokens. Multiplying
  // the execution price by that fixed supply makes this market cap, not FDV.
  const marketCapRaw = f.tokenRaw > 0n ? (f.xcpRaw * XCP69_EXACT.HARD_CAP) / f.tokenRaw : 0n;
  const price = formatExact(rawToDecimalString(priceRaw, 8), {
    minimumFractionDigits: 8,
    maximumFractionDigits: 8,
  });
  const usdTotal =
    f.xcpUsd && f.xcpUsd > 0
      ? ` · $${((Number(f.xcpRaw) / 100_000_000) * f.xcpUsd).toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`
      : "";
  const marketCapUsd =
    f.xcpUsd && f.xcpUsd > 0
      ? ` · $${((Number(marketCapRaw) / 100_000_000) * f.xcpUsd).toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`
      : "";
  const tx =
    f.txHash && /^[0-9a-f]{64}$/i.test(f.txHash)
      ? `<a href="https://xcp.io/tx/${f.txHash}">TX</a>`
      : null;
  const links = [f.address ? addressLink(f.address) : null, tx, `<a href="${SITE}/${encodeURIComponent(f.asset)}">Trade</a>`]
    .filter((link): link is string => link !== null)
    .join(" · ");
  return withPhoto(
    f.asset,
    [
      sizeBar(f.buy ? BUY_EMOJI : SELL_EMOJI, f.tokenRaw, TRADE_PAIR_CAP),
      `${assetLink(f.asset)} ${f.buy ? "bought" : "sold"}`,
      `${tokens(f.tokenRaw)} tokens · ${xcp(f.xcpRaw)} XCP`,
      `${price} XCP/token${usdTotal}`,
      `MCap: ${xcp(marketCapRaw)} XCP${marketCapUsd}`,
      links,
    ].join("\n"),
  );
}

function percent(part: bigint, whole: bigint): number {
  if (whole <= 0n) return 0;
  // Basis points in bigint, then one division at the end — a percentage of two
  // raw quantities should not go through a double just to be rounded.
  return Number((big(part) * 10_000n) / whole) / 100;
}

const short = (addr: string) =>
  addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
