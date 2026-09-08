# Amount entry and localization contract

The interface language, display number format, and fiat currency are separate preferences. Deliberately selecting a language also selects its suggested fiat currency, replacing any previous currency choice. Selecting a currency changes only currency. Number format follows the selected language until explicitly overridden; selecting a language never resets that override. USD remains selectable in every language. Formatting helpers are presentation-only and must never feed editable values or compose parameters.

## Exact inputs and Core fields

The application pins SDK commit `79f190308d4b60cc3ec9023beada21e0ee776213` from [wallet-sdk PR 1](https://github.com/XCP/wallet-sdk/pull/1). This is an immutable review dependency, not a published SDK release. The pure `/amounts` contract and shared vectors are maintained there.

- Preserve the whole draft, including malformed sequential edits. `-5`, `1e5`, `0,5`, grouping, and a ninth decimal cannot become another valid amount. Pasted line breaks remain visibly escaped rather than concatenating digits.
- Parse canonical ASCII digits and a period only. A field is empty, incomplete, invalid, or valid; only valid drafts yield a raw integer. Do not submit a previous valid value underneath an invalid draft.
- Core raw asset quantities are integers. Divisible assets use eight places; indivisible assets use zero. Asset identity and divisibility belong to each leg independently. XCP-69 launches in these trading forms are divisible; that does not justify assuming eight places in generic order readers.
- Fees are fractional sat/vB values, not raw asset amounts. Block counts, commission fractions, LP quantities, and text fields have separate contracts. Empty custom fee means automatic; an explicit zero is not replaced with automatic. Slippage and fee fields reject unsupported values instead of clamping them into another intent.
- Max, percentages, pair reversal, and derived limit-order legs use exact integer arithmetic. When price creates a derived quantity, rounding preserves the typed leg and the user's price constraint; it is not uniformly downward.
- Final quote refresh must succeed for the same amount, pair, account, and settings. A worse refresh cannot silently reduce a reviewed minimum. Changed deposit counterpart quantities require review again. Quote failures cannot become zero fees or balances.

Core source was inspected at `67e10db3`, including API compose/query normalization, order matching, fairmint/fairminter, pool deposit/withdraw, asset divisibility and fee handling. Core's `int(fraction * 1e8)` can alter particular floating-point commission fractions; the SDK rejects values that cannot survive that conversion exactly rather than adjusting them silently.

The SDK checks compose transaction envelopes and signed transaction invariants. It does not independently decode and compare every Counterparty message against the requested intent for every hosted wallet adapter. The extension's native composer has additional semantic verification. Neither capability should be described as universal payload verification.

The direct dispenser router also uses the SDK's field serializers. It checks reviewed recipient/payment outputs, rejects changed signed transaction envelopes, and rereads vend size, price, oracle identity and stock before signing and broadcasting, including retries. That does not guarantee dispenser availability when a later block is mined, or independently reconstruct every input's parent value/network fee in this router.

The inscription Create flow uses Core's actual `/utxos/<outpoint>/balances` endpoint. Only a successful complete empty result authorizes a candidate as having no confirmed Counterparty balances; failed or ambiguous reads block the operation. The selected prevout is checked against its hash-verified parent bytes, amount and source script, and balances are reread after commit signing. Commit/reveal signed PSBTs and finalized raw transactions must retain their original Bitcoin envelopes. These checks cover confirmed Counterparty state, not an inventory of every Bitcoin metaprotocol. A rejected reveal stops the second broadcast; it cannot undo an already-broadcast commit.

## Preferences and terminology

Language selections suggest JPY for Japanese, CNY for Simplified Chinese, HKD for Hong Kong Traditional Chinese, KRW for Korean, BRL for Brazilian Portuguese, and EUR for French. English and the shared Latin American Spanish catalog suggest USD. Taiwan Traditional Chinese, Russian and Ukrainian also suggest USD because the current FX feed does not support TWD, RUB or UAH. These are defaults, not a restriction on available currency choices.

Only a deliberate language action applies this suggestion: header/menu choices, the homepage footer, its English link, and acceptance of a language suggestion. Opening a localized URL, reloading, using browser history, or returning through a remembered-language redirect preserves a later currency override. Currency menus show explicit currency codes; there is no competing Auto choice. Browser detection supplies the initial currency only before a visitor has chosen a language or currency. Currency has its own header dropdown from 1340px; the adjacent language control expands from a globe to its native name at 1536px. Narrower layouts keep currency accessible in the existing menu.

The separate number-format picker includes German and Spanish regional number conventions, including Spain and Venezuela. The Spanish message catalog remains shared until reviewed regional vocabulary warrants overrides. Chinese script and regional catalogs remain distinct. This change does not claim that model-authored text was reviewed by native speakers.

Current fiat estimates can follow the selected currency. Historical price charts remain explicitly USD until dated FX conversion is available; applying today's CNY rate to an old USD price would misstate historical CNY pricing. Number separators remain independently configurable on those USD charts.

Critical errors use stable codes and localized instructions, with copyable original diagnostic details. Reviewed catalog entries keep their provenance; new model-authored entries are marked as such. Source-key coverage is a completeness check, not a translation-quality assessment.

Verified terminology references, reviewed 7 September 2026:

- [Counterwallet](https://github.com/CounterpartyXCP/counterwallet) documents its historical Transifex translation workflow. Its archived source is terminology/history, while current Core defines transaction semantics.
- [Zaif order-book trading](https://zaif.jp/doc_orderbook_trading) and [fees](https://zaif.jp/fee?lang=ja) inform Japanese trading vocabulary such as 指値, 成行, and 手数料. Zaif's execution mechanism is not Counterparty's order contract.
- [Uniswap's Spanish AMM explanation](https://blog.uniswap.org/es-ES/what-is-an-automated-market-maker) informs familiar liquidity and slippage vocabulary. Its Spanish regional tag alone does not establish that a different wallet noun is required in every region.
- [UniSat Wallet API](https://docs.unisat.io/dev/unisat-developer-center/unisat-wallet) and [transfer inscription guide](https://docs.unisat.io/services/products/unisat-wallet/how-to-inscribe-transfer-using-unisat-wallet) inform Bitcoin metaprotocol vocabulary. BRC-20 transferable balances and inscriptions must not be imported as Counterparty transaction semantics.

## Validation and remaining work

Tests exercise actual controlled input handlers, strict compose HTTP serialization, quote failures and changed intent, exact quantities above JavaScript's safe integer range, per-field settings, and language/number/currency invariance in rendered React components. Inscription fixtures cryptographically sign the production commit/reveal builders offline and prove changed envelopes stop broadcast. Actual Chromium verifies sequential invalid edits, exact large quote parameters, and independent saved number/fiat preferences. No live transaction was signed or broadcast during validation.

Changing number or currency preferences preserves the current draft. Launchpad language changes navigate to a different localized URL and currently clear the form; preserving drafts across that navigation remains a UX follow-up. Extension language changes have a separate in-place implementation.

The pinned SDK dependency has passed its own 263-test suite and ESM, declarations and standalone CJS builds; this application can build from the immutable commit without publishing a package release. Supported adapters retain the verification limits described above. Regional-speaker feedback remains valuable, but this release's catalog review is model-assisted and must not be represented as native-speaker approval. Merging, website deployment and extension store publication are separate actions.

The final contextual pass distinguishes pending asset amounts from transaction counts, seller BTC receipts from payments, and mint escrow from immediately received tokens. Slippage tolerance, order expiry and LP ownership use the actual form and Core meaning. Russian and Ukrainian graduation labels describe the opening of the pool rather than inventing a school-graduation term that can be confused with token issuance. Japanese and Chinese regional wording, and shared Spanish, remain separate catalogs with their existing review provenance.

Source explanations now state that a successful mint exchanges contributed XCP for tokens that can lose value. Initial LP tokens go to an unspendable address, locking the initial liquidity; the pool's underlying assets are not destroyed. These distinctions are grounded in Core fairminter resolution and pool-deposit handling, not copied from another exchange's execution model.
