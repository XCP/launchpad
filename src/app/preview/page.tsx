import { LaunchView } from "@/app/[asset]/launch-view";
import type { Fairmint, Pool, PoolSnapshot } from "@/lib/api/counterparty";
import { fetchXcpUsd } from "@/lib/api/price";
import { type Fairminter, XCP69 } from "@/lib/xcp69";

export const metadata = {
  title: "State preview — xcp.fun",
  robots: { index: false },
};

/**
 * Design harness: the real LaunchView rendered in every lifecycle state
 * with fabricated data, so each card/form/panel can be art-directed without
 * waiting for a live launch to reach that state. Same component as
 * production — this page cannot drift from the real thing.
 *
 * Client islands still talk to real APIs (mint/trade panels quote against
 * a launch that doesn't exist), so interactive bits show their empty
 * states here; everything visual is faithful.
 */

const HEIGHT = 962_400; // fixed pretend chain height
const ASSET = "HOPIUM";
const CREATOR = "bc1qhopium0creator0addressxxxxxxxxxxxxxx";
const MINT_PRICE = XCP69.PRICE / XCP69.QUANTITY_BY_PRICE;

function baseFm(over: Partial<Fairminter>): Fairminter {
  return {
    tx_hash: "f".repeat(64),
    tx_index: 4_206_969,
    block_index: HEIGHT - 300,
    source: CREATOR,
    asset: ASSET,
    asset_longname: null,
    description: "https://xcp.fun/j/HOPIUM.json",
    price: XCP69.PRICE,
    quantity_by_price: XCP69.QUANTITY_BY_PRICE,
    hard_cap: XCP69.HARD_CAP,
    soft_cap: XCP69.SOFT_CAP,
    soft_cap_deadline_block: HEIGHT - 156 + XCP69.DEADLINE_BLOCKS,
    start_block: HEIGHT - 156,
    end_block: 0,
    burn_payment: false,
    max_mint_per_tx: XCP69.MAX_MINT_PER_TX,
    max_mint_per_address: XCP69.MAX_MINT_PER_ADDRESS,
    premint_quantity: 0,
    minted_asset_commission_int: 0,
    lock_description: true,
    lock_quantity: true,
    divisible: true,
    pool_quantity: XCP69.POOL_QUANTITY,
    lp_asset: "A693330289231613769", // valid house-format sample
    status: "open",
    earned_quantity: null,
    paid_quantity: null,
    confirmed: true,
    ...over,
  };
}

/** Deterministic fake mint tape summing exactly to `totalEarned`. */
function fakeMints(count: number, totalEarned: number): Fairmint[] {
  const mints: Fairmint[] = [];
  let remaining = totalEarned;
  for (let i = 0; i < count; i++) {
    const weight = ((i * 2654435761) % 89) + 12; // deterministic spread
    const share =
      i === count - 1
        ? remaining
        : Math.min(
            remaining,
            Math.round((totalEarned * weight) / (101 * count / 2)) -
              (Math.round((totalEarned * weight) / (101 * count / 2)) %
                XCP69.QUANTITY_BY_PRICE),
          );
    if (share <= 0) continue;
    remaining -= share;
    mints.push({
      tx_hash: `${i.toString(16).padStart(4, "0")}${"e".repeat(60)}`,
      block_index: HEIGHT - 150 + i * 3,
      source: `bc1qminter${(i * 7919).toString(36).padStart(6, "0")}preview${i}`,
      fairminter_tx_hash: "f".repeat(64),
      asset: ASSET,
      earn_quantity: share,
      paid_quantity: Math.round(share * MINT_PRICE),
      commission: 0,
      status: "valid",
    });
  }
  return mints.reverse();
}

/** Synthetic price walk: opens at 2.23× mint, wanders up to ~7.5×. */
function fakeHistory(): PoolSnapshot[] {
  const k = XCP69.POOL_QUANTITY * (XCP69.SOFT_CAP / 1e5); // reserves product
  const openMult = XCP69.SOFT_CAP / XCP69.POOL_QUANTITY;
  const snapshots: PoolSnapshot[] = [];
  for (let i = 0; i < 48; i++) {
    const t = i / 47;
    const mult = Math.max(
      0.9,
      openMult + (7.5 - openMult) * t + Math.sin(i * 1.7) * 1.1 * (0.3 + t),
    );
    const price = mult * MINT_PRICE;
    const xcp = Math.sqrt(k * price);
    const tokens = Math.sqrt(k / price);
    snapshots.push({
      block_index: HEIGHT - 140 + i * 3,
      tx_index: 4_207_000 + i,
      asset_a: ASSET,
      asset_b: "XCP",
      reserve_a: Math.round(tokens),
      reserve_b: Math.round(xcp),
    });
  }
  return snapshots;
}

export default async function PreviewPage() {
  const xcpUsd = await fetchXcpUsd();

  const scheduled = baseFm({
    status: "pending",
    start_block: HEIGHT + 96,
    soft_cap_deadline_block: HEIGHT + 96 + XCP69.DEADLINE_BLOCKS,
    block_index: HEIGHT - 48,
  });

  const mintingEarned = 2.9e15; // 42% of the sale
  const minting = baseFm({
    status: "open",
    earned_quantity: mintingEarned,
    paid_quantity: Math.round(mintingEarned * MINT_PRICE),
  });

  const graduated = baseFm({
    status: "closed",
    earned_quantity: XCP69.SOFT_CAP,
    paid_quantity: Math.round(XCP69.SOFT_CAP * MINT_PRICE),
    soft_cap_deadline_block: HEIGHT - 140, // rewritten to the fill block
  });
  const history = fakeHistory();
  const last = history[history.length - 1];
  const pool: Pool = {
    asset_a: ASSET,
    asset_b: "XCP",
    reserve_a: last.reserve_a,
    reserve_b: last.reserve_b,
    lp_asset: "A693330289231613769",
  };

  const refundedEarned = 3.1e15; // 45% — close, but not close enough
  const refunded = baseFm({
    status: "closed",
    earned_quantity: refundedEarned,
    paid_quantity: Math.round(refundedEarned * MINT_PRICE),
  });

  const states: {
    title: string;
    note: string;
    fm: Fairminter;
    phase: "scheduled" | "minting" | "graduated" | "refunded";
    mints: Fairmint[];
    pool: Pool | null;
    history: PoolSnapshot[];
  }[] = [
    {
      title: "Scheduled",
      note: "confirmed on-chain, minting not yet open",
      fm: scheduled,
      phase: "scheduled",
      mints: [],
      pool: null,
      history: [],
    },
    {
      title: "Minting",
      note: "42% sold, 38 addresses, window running",
      fm: minting,
      phase: "minting",
      mints: fakeMints(38, mintingEarned),
      pool: null,
      history: [],
    },
    {
      title: "Graduated",
      note: "sold out, pool live, trading at ~7.5× mint",
      fm: graduated,
      phase: "graduated",
      mints: fakeMints(74, XCP69.SOFT_CAP),
      pool,
      history,
    },
    {
      title: "Refunded",
      note: "45% at the deadline — everyone repaid",
      fm: refunded,
      phase: "refunded",
      mints: fakeMints(31, refundedEarned),
      pool: null,
      history: [],
    },
  ];

  return (
    <div className="space-y-16">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <strong>State preview.</strong> The real launch page component fed
        fabricated {ASSET} data — one section per lifecycle state, for design
        work. Interactive panels quote against a launch that doesn&apos;t
        exist, so they show their empty states; everything else is faithful.
      </div>

      {states.map((s) => (
        <section key={s.title}>
          <div className="mb-4 flex items-baseline gap-3 border-b border-gray-200 pb-2">
            <h2 className="text-xl font-bold">{s.title}</h2>
            <span className="text-sm text-gray-400">{s.note}</span>
          </div>
          <LaunchView
            asset={ASSET}
            fm={s.fm}
            conforming
            phase={s.phase}
            blockHeight={HEIGHT}
            mints={s.mints}
            pool={s.pool}
            priceHistory={s.history}
            xcpUsd={xcpUsd}
          />
        </section>
      ))}
    </div>
  );
}
