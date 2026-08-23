export const COUNTERPARTY_API_BASE = "https://api.counterparty.io:4000/v2";
export const XCP_API_BASE = "https://api.xcp.io/v2";
export const CDN_BASE = "https://cdn.xcp.io";

/**
 * Where an inscription is looked at. `/content/<id>` is the inscribed thing
 * itself — for a text/html launch, the artwork running — and `/inscription/<id>`
 * is the record about it.
 *
 * An inscription id is `<reveal txid>i<index>`, and a fairminter inscription
 * is always the first envelope in its own reveal transaction, so `i0` on the
 * fairminter's tx_hash names it with nothing to look up.
 */
export const ORDINALS_BASE = "https://ordinals.com";
export const inscriptionId = (revealTxid: string) => `${revealTxid}i0`;
export const inscriptionContentUrl = (revealTxid: string) =>
  `${ORDINALS_BASE}/content/${inscriptionId(revealTxid)}`;
export const inscriptionPageUrl = (revealTxid: string) =>
  `${ORDINALS_BASE}/inscription/${inscriptionId(revealTxid)}`;

/** Block at which fairmint_pool activated on mainnet (2026-08-05). */
export const FAIRMINT_POOL_ACTIVATION_BLOCK = 961_100;
