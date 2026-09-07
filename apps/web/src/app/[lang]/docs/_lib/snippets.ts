/**
 * The docs' code blocks and tables, shared by the rendered page and the
 * copy-as-markdown export so the two can never drift (the JSX/markdown
 * split is exactly how this page's numbers went stale once before).
 */

export const PREDICATE_SNIPPET = `export const XCP69 = {
  /** 100M supply */
  HARD_CAP: 10_000_000_000_000_000,
  /** 69M public sale — reaching it IS selling out (all-or-nothing) */
  SOFT_CAP: 6_900_000_000_000_000,
  /** 31M seeded into the TOKEN/XCP pool at close, LP burned */
  POOL_QUANTITY: 3_100_000_000_000_000,
  /** 1,000-token lots */
  QUANTITY_BY_PRICE: 100_000_000_000,
  /** 0.01 XCP per lot */
  PRICE: 1_000_000,
  /** 1M tokens = 10 XCP per address; 69M ÷ 1M = 69 participants */
  MAX_MINT_PER_ADDRESS: 100_000_000_000_000,
  MAX_MINT_PER_TX: 100_000_000_000_000,
  /** Mint window: soft_cap_deadline_block − start_block, exactly (~7 days) */
  DEADLINE_BLOCKS: 1_000,
} as const;

/** core's block_index sentinel for unconfirmed transactions */
const MEMPOOL_BLOCK_INDEX = 9_999_999;

export function isXcp69(fm: Fairminter): boolean {
  return (
    (fm.status === "pending" || fm.status === "open" || fm.status === "closed") &&
    fm.pool_quantity === XCP69.POOL_QUANTITY &&
    fm.soft_cap === XCP69.SOFT_CAP &&
    fm.hard_cap === XCP69.HARD_CAP &&
    fm.quantity_by_price === XCP69.QUANTITY_BY_PRICE &&
    fm.price === XCP69.PRICE &&
    fm.max_mint_per_address === XCP69.MAX_MINT_PER_ADDRESS &&
    fm.max_mint_per_tx === XCP69.MAX_MINT_PER_TX &&
    fm.premint_quantity === 0 &&
    (fm.minted_asset_commission_int ?? 0) === 0 &&
    fm.lock_quantity &&
    fm.lock_description &&
    fm.divisible &&
    !fm.burn_payment &&
    !fm.asset.startsWith("A") && // named assets only
    // timing: scheduled start, fixed window, no end_block
    fm.start_block > 0 &&
    fm.end_block === 0 &&
    (fm.confirmed === false ||
      fm.block_index >= MEMPOOL_BLOCK_INDEX || // unconfirmed sentinel
      fm.start_block > fm.block_index) &&      // confirmed before start
    (fm.status === "closed"
      // core rewrites the deadline to the fill block on early sell-out
      ? fm.soft_cap_deadline_block <= fm.start_block + XCP69.DEADLINE_BLOCKS
      : fm.soft_cap_deadline_block === fm.start_block + XCP69.DEADLINE_BLOCKS)
  );
}`;

export const COMPOSE_LAUNCH_SNIPPET = `# Compose an XCP-69 launch (unsigned tx back; sign + broadcast yourself).
# START = a future block: the pre-announcement window. The launch must
# CONFIRM before START or it opens instantly and fails conformance.
curl -G "https://api.counterparty.io:4000/v2/addresses/$ISSUER/compose/fairminter" \\
  --data-urlencode "asset=MYTOKEN" \\
  --data-urlencode "price=1000000" \\
  --data-urlencode "quantity_by_price=100000000000" \\
  --data-urlencode "hard_cap=10000000000000000" \\
  --data-urlencode "soft_cap=6900000000000000" \\
  --data-urlencode "pool_quantity=3100000000000000" \\
  --data-urlencode "lp_asset=$LP_NAME" \\  # any unissued numeric; house style: 69…69, ≡69 (mod 97)
  --data-urlencode "max_mint_per_address=100000000000000" \\
  --data-urlencode "max_mint_per_tx=100000000000000" \\
  --data-urlencode "start_block=$START" \\
  --data-urlencode "soft_cap_deadline_block=$((START + 1000))" \\
  --data-urlencode "end_block=0" \\
  --data-urlencode "premint_quantity=0" \\
  --data-urlencode "minted_asset_commission=0" \\
  --data-urlencode "burn_payment=false" \\
  --data-urlencode "lock_quantity=true" \\
  --data-urlencode "lock_description=true" \\
  --data-urlencode "divisible=true" \\
  --data-urlencode "description=https://…/MYTOKEN.json" \\
  --data-urlencode "sat_per_vbyte=$FEE_RATE" \\
  --data-urlencode "verbose=true"`;

export const COMPOSE_MINT_SNIPPET = `# Compose a mint. quantity is the TOKEN amount (raw, whole lots) —
# the XCP price is computed by consensus and debited from the minter's
# on-ledger XCP balance; nothing rides in the Bitcoin outputs.
curl -G "https://api.counterparty.io:4000/v2/addresses/$MINTER/compose/fairmint" \\
  --data-urlencode "asset=MYTOKEN" \\
  --data-urlencode "quantity=100000000000000" \\
  --data-urlencode "sat_per_vbyte=$FEE_RATE"

# Issuer-side XCP cost of the pool settlement (prepaid at creation):
curl "https://api.counterparty.io:4000/v2/addresses/$ISSUER/compose/pooldeposit/estimatexcpfees"`;

export const CURL_OPEN_LAUNCHES = `# All fairminters currently minting (filter with isXcp69 client-side)
curl "https://api.counterparty.io:4000/v2/fairminters?status=open&verbose=true"

# Every mint into one launch
curl "https://api.counterparty.io:4000/v2/fairminters/<TX_HASH>/fairmints"`;

export const CURL_POOL = `# Pool state (reserves) — a row here means the launch graduated
curl "https://api.counterparty.io:4000/v2/pools/<ASSET>/XCP"

# Price series: one row per reserve mutation
curl "https://api.counterparty.io:4000/v2/pools/<ASSET>/XCP/price_history"

# Swap quote for a given input quantity (raw integer)
curl "https://api.counterparty.io:4000/v2/pools/<ASSET>/XCP/quote?quantity=100000000"`;

export const CURL_HOLDERS = `# Holders — the unspendable address appears holding the burned LP
curl "https://api.counterparty.io:4000/v2/assets/<ASSET>/holders"`;

export const FEE_ROWS: [string, string][] = [
  ["Creator's share of the 690 XCP raise", "0%"],
  ["Protocol / platform share of the raise", "0%"],
  ["Premine or mint commission to the creator", "0"],
  ["LP tokens", "burned at the unspendable address, forever"],
  ["Swap fee after launch", "50 bps, paid to the pool (the LP is burned, so it deepens locked liquidity)"],
];

export const EVENTS: [string, string][] = [
  ["NEW_FAIRMINTER", "a launch is created"],
  ["NEW_FAIRMINT", "someone mints (also visible in the mempool before confirmation)"],
  ["OPEN_POOL", "the launch graduated — the TOKEN/XCP pool was seeded"],
  ["POOL_MATCH", "a swap executed against the pool"],
  ["ASSET_DESTRUCTION", "escrowed supply destroyed — on a missed soft cap, tagged “soft cap not reached”"],
];
