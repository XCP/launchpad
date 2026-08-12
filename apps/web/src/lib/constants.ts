export const COUNTERPARTY_API_BASE = "https://api.counterparty.io:4000/v2";
export const XCP_API_BASE = "https://api.xcp.io/v2";
export const CDN_BASE = "https://cdn.xcp.io";

/** Block at which fairmint_pool activated on mainnet (2026-08-05). */
export const FAIRMINT_POOL_ACTIVATION_BLOCK = 961_100;

/**
 * The design-phase preview tools (the asset page's lifecycle-state pill, the
 * profile's sample data) are visible only to this address. They exist to look
 * at states real data can't produce yet; to everyone else they'd just be a
 * way to see numbers that aren't true.
 */
export const PREVIEW_ADDRESS = "19QWXpMXeLkoEKEJv2xo9rn8wkPCyxACSX";
