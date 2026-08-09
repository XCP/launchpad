export const COUNTERPARTY_API_BASE = "https://api.counterparty.io:4000/v2";
export const XCP_API_BASE = "https://api.xcp.io/v2";
export const CDN_BASE = "https://cdn.xcp.io";

/** Block at which fairmint_pool activated on mainnet (2026-08-05). */
export const FAIRMINT_POOL_ACTIVATION_BLOCK = 961_100;

/**
 * Design-phase escape hatch: show non-XCP-69 fairminters so real on-chain data
 * exercises every lifecycle state. Flip to false before launch — the site's
 * editorial policy is XCP-69 only.
 */
export const SHOW_NONCONFORMING = true;
