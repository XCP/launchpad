# Browser API routing

The public Counterparty node is reserved primarily for operations where current state matters: quotes, spend checks, composition, broadcasting, and active mint allowance. Ordinary browsing first uses the launch index at `api.xcp.fun` and Explorer at `api.xcp.io`.

## Indexed reads and compatibility

Asset pages and metadata share one indexed launch lookup. A usable closed indexed fairminter eliminates the redundant `/assets/{asset}/fairminters` lookup. Active server-rendered launches still refresh protocol status so opening, expiry and sellout are not delayed until the next index sync. Disconnected mint forms use the index with existing launch-room progress updates. Missing or incomplete launch identity falls back to the protocol reader; a failed fallback remains an error, not an empty launch or zero allowance.

Original creation evidence still matters. In particular, the live EVOLVEDPEPE row has no `original_deadline`; its immutable creation event must still be fetched to distinguish its original deadline from an early settlement block. A fixture with complete indexed evidence can avoid both reads, but that is not the current live EVOLVEDPEPE case.

The launch index reconciles every five minutes. Connected mint forms therefore retain direct node reads every 20 seconds. Connecting a wallet clears the previous indexed fairminter while the first direct read is pending; subsequent failed live refreshes retain the last successful live result. Transaction composition still validates against the node before signing.

Display height uses Explorer's 15-second `/v2/status` heartbeat, including its lag indication. The older home summary is not a fresh height source. A lagging or unavailable index falls back to the node; countdowns near their target keep direct parser checks.

## Caller policy

| Caller | Route |
| --- | --- |
| Closed launch identity and metadata, disconnected mint display | Indexed `/v2/launches/{asset}`, protocol fallback only if needed |
| Active launch server rendering | Shared indexed lookup plus fresh protocol status at the existing cache window |
| Holders, LP holder listings, indexed history/candles | Existing Explorer and launch-index endpoints |
| Routine issuer history, raw trade history fallback, books, profile orders, transaction/order trackers | Read-only `api.xcp.fun/node/v2` compatibility gateway |
| Connected mint allowance, confirmed address allowance | Direct Counterparty, retaining live refresh cadence |
| SDK available balance and pending debits, including profile available-to-spend XCP | Direct Counterparty; exact spendability and pending state preserved |
| Swap/liquidity quotes, fee estimates, dispense preflight, compose and signing checks | Direct Counterparty |
| Name availability, final launch schedule check, just-broadcast visibility | Direct Counterparty; indexed visibility checked first |
| Inscription funding candidates, parent transactions and asset-safe UTXOs | Direct Counterparty/Electrs |
| Broadcasts | Existing SDK direct provider sequence; no new proxy |

## Read gateway boundaries

`/node/v2` is a fixed-origin, allowlisted GET gateway. It admits only the site's known read paths and query parameters. It preserves response bytes, oversized quantities, cursors, status codes and Retry-After. It forwards no caller credentials, follows no redirects and makes no automatic upstream retries. Cancellation and a bounded timeout stop abandoned reads. Responses are streamed with compression metadata and `no-store`.

The gateway's 429 cooldown is per isolate and separate from the indexer's integration state. It is not a global quota or global deduplication mechanism. Proxying a read alone does not eliminate node work and adds a Worker invocation. The measured reduction comes from using indexed data before the gateway; no account-wide cost reduction is implied.

Server protocol reads remain on Next's patched fetch so their existing persistent cache windows survive, including immutable creation events. Indexed launch requests retain their existing API service binding. Browser gateway responses are not cached as wallet state.

The same-origin `/api/cp/v2` endpoint remains an emergency GET fallback for the SDK's direct reads. It cannot broadcast. This preserves the existing large-transaction broadcast path without introducing Cloudflare's URL-size ceiling ahead of the node.

## Why Explorer is not a drop-in node

Explorer does not expose `/assets/{asset}/fairminters`, live composition or equivalent Bitcoin UTXO verification. Its pagination and some response shapes differ. Its transaction event view is capped and truncates large metadata, and some best-effort failures become empty results. Those contracts must not be used as proof of spendability, an exact mint cap or a complete protocol history.

The launch-index creator list also filters conformance differently from the existing issuer-history UI. The raw compatibility path preserves those historical counts until an equivalent indexed contract exists.

## Validation and rollout

The regression suites exercise actual SDK serialization with mocked network boundaries, large raw amounts, live/direct routing, lossless read forwarding, error and cooldown behavior, index fallback, relaunch identity, connection transitions and retained live caps. No real transaction is signed or broadcast by tests. Production React Flight tests compare page-and-metadata read counts using controlled API fixtures.

Deploy the API Worker before the web Worker, then verify public indexed and gateway GETs, page rendering, live browser errors and the deployed versions. Keep the distinction between fixture request reductions and production account-wide usage measurements.
