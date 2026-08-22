/**
 * A small xcp.fun-native address summary for row hovers.
 *
 * The browser used to have only two bad choices here: say nothing, or fan out
 * to an explorer for several generic address facts. These queries stay inside
 * the two indexes the launchpad already maintains. They run only when someone
 * opens a hover card, and `batch()` keeps the three indexed reads to one D1
 * round trip.
 */

export interface TrackedActivityRow {
  block_index: number;
  sort_index: number;
  id: string;
  token_delta: string;
  xcp_delta: string;
  kind: "mint" | "buy" | "sell";
}

export interface TrackedPosition {
  quantity: string;
  cost_xcp: string;
  realized_pnl_xcp: string;
  complete: boolean;
}

export interface AddressLaunchpadSummary {
  mints: {
    transactions: number;
    launches: number;
    paid_xcp: string;
  };
  market: {
    fills: number;
    assets: number;
    bought_xcp: string;
    sold_xcp: string;
  };
  asset: {
    mints: number;
    buys: number;
    sells: number;
    bought_xcp: string;
    sold_xcp: string;
    tracked: TrackedPosition;
  };
}

/**
 * Average-cost accounting over the mint/trade rows xcp.fun has indexed.
 *
 * `complete` means only that every disposal was covered by an earlier tracked
 * acquisition and that the row cap was not hit. The client makes the stronger
 * check by comparing `quantity` with the live holder balance; a send, LP move,
 * dispenser, or other outside movement therefore suppresses PnL instead of
 * becoming a made-up zero-cost lot.
 */
export function foldTrackedPosition(
  rows: TrackedActivityRow[],
  truncated = false,
): TrackedPosition {
  let quantity = 0n;
  let cost = 0n;
  let realized = 0n;
  let complete = !truncated;

  for (const row of rows) {
    const token = BigInt(row.token_delta);
    const xcp = BigInt(row.xcp_delta);
    if (token > 0n) {
      // A mint or buy must carry its XCP leg. A zero-cost positive movement is
      // an acquisition this focused index cannot price honestly.
      if (xcp >= 0n) complete = false;
      quantity += token;
      if (xcp < 0n) cost += -xcp;
      continue;
    }
    if (token >= 0n) continue;

    const sold = -token;
    if (quantity <= 0n || sold > quantity) {
      complete = false;
      // Keep the aggregate activity useful, but stop pretending the remaining
      // basis is defined after an untracked acquisition was disposed of.
      quantity = quantity > sold ? quantity - sold : 0n;
      cost = 0n;
      continue;
    }
    const basis = (cost * sold) / quantity;
    realized += (xcp > 0n ? xcp : 0n) - basis;
    cost -= basis;
    quantity -= sold;
  }

  return {
    quantity: quantity.toString(),
    cost_xcp: cost.toString(),
    realized_pnl_xcp: realized.toString(),
    complete,
  };
}

interface MintTotalsRow {
  transactions: number;
  launches: number;
  paid_xcp: string;
}

interface MarketTotalsRow {
  fills: number;
  assets: number;
  bought_xcp: string;
  sold_xcp: string;
}

const ACTIVITY_LIMIT = 2_000;

export async function getAddressLaunchpadSummary(
  db: D1Database,
  address: string,
  asset: string,
): Promise<AddressLaunchpadSummary> {
  const [mintResult, marketResult, activityResult] = await db.batch([
    db
      .prepare(
        `SELECT COUNT(*) AS transactions,
                COUNT(DISTINCT m.launch_tx) AS launches,
                CAST(COALESCE(SUM(CAST(m.paid_quantity AS INTEGER)), 0) AS TEXT) AS paid_xcp
           FROM launch_mints m
           JOIN launches l ON l.tx_hash = m.launch_tx
          WHERE m.source = ?1 AND l.conforming IS NOT 0`,
      )
      .bind(address),
    db
      .prepare(
        `SELECT COUNT(*) AS fills,
                COUNT(DISTINCT asset) AS assets,
                CAST(COALESCE(SUM(CASE WHEN kind = 'buy'
                     THEN -CAST(xcp_delta AS INTEGER) ELSE 0 END), 0) AS TEXT) AS bought_xcp,
                CAST(COALESCE(SUM(CASE WHEN kind = 'sell'
                     THEN CAST(xcp_delta AS INTEGER) ELSE 0 END), 0) AS TEXT) AS sold_xcp
           FROM asset_events
          WHERE address = ?1`,
      )
      .bind(address),
    db
      .prepare(
        `SELECT block_index, sort_index, id, token_delta, xcp_delta, kind
           FROM (
             SELECT m.block_index AS block_index,
                    COALESCE(m.tx_index, 0) AS sort_index,
                    m.tx_hash AS id,
                    m.earn_quantity AS token_delta,
                    '-' || m.paid_quantity AS xcp_delta,
                    'mint' AS kind
               FROM launch_mints m
               JOIN launches l ON l.tx_hash = m.launch_tx
              WHERE m.source = ?1 AND l.asset = ?2
                AND l.conforming = 1 AND l.phase = 'graduated'
             UNION ALL
             SELECT e.block_index AS block_index,
                    COALESCE(e.event_index, 0) AS sort_index,
                    e.id AS id,
                    e.token_delta AS token_delta,
                    e.xcp_delta AS xcp_delta,
                    e.kind AS kind
               FROM asset_events e
              WHERE e.address = ?1 AND e.asset = ?2
           )
          ORDER BY block_index, sort_index, id
          LIMIT ${ACTIVITY_LIMIT + 1}`,
      )
      .bind(address, asset),
  ]);

  const mint = (mintResult.results as unknown as MintTotalsRow[])[0] ?? {
    transactions: 0,
    launches: 0,
    paid_xcp: "0",
  };
  const market = (marketResult.results as unknown as MarketTotalsRow[])[0] ?? {
    fills: 0,
    assets: 0,
    bought_xcp: "0",
    sold_xcp: "0",
  };
  const allRows = activityResult.results as unknown as TrackedActivityRow[];
  const truncated = allRows.length > ACTIVITY_LIMIT;
  const rows = allRows.slice(0, ACTIVITY_LIMIT);

  let mints = 0;
  let buys = 0;
  let sells = 0;
  let boughtXcp = 0n;
  let soldXcp = 0n;
  for (const row of rows) {
    const xcp = BigInt(row.xcp_delta);
    if (row.kind === "mint") mints += 1;
    if (row.kind === "buy") {
      buys += 1;
      if (xcp < 0n) boughtXcp += -xcp;
    }
    if (row.kind === "sell") {
      sells += 1;
      if (xcp > 0n) soldXcp += xcp;
    }
  }

  return {
    mints: mint,
    market,
    asset: {
      mints,
      buys,
      sells,
      bought_xcp: boughtXcp.toString(),
      sold_xcp: soldXcp.toString(),
      tracked: foldTrackedPosition(rows, truncated),
    },
  };
}
