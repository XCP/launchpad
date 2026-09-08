# Localization acceptance

This pass follows the amount and preference contract in [amount-and-localization-contract.md](amount-and-localization-contract.md). Its purpose is to make existing Launchpad journeys understandable and usable in the ten translated locales. English positioning and explanation proposals are tracked separately in [draft PR25](https://github.com/XCP/launchpad/pull/25).

## What counts as done

- Read the selected messages in their component and sentence context. Check spend/receive direction, amounts versus counts, fees, expiry, pending states and the connected wallet's LP ownership. Counterparty Core defines transaction meaning.
- Use consistent, familiar terminology supported by relevant products and communities. Preserve acceptable regional differences. A different synonym alone does not reopen the glossary.
- Check discovery, minting, trading, swap/liquidity, limit orders, dispenser and Create pages, connection, Rewards, FAQ, Docs, Activity and Stats. Exercise invalid, insufficient-balance, unavailable, pending and failure states where the shared transaction components expose them.
- Check every translated locale at phone and desktop widths. Inspect representative screenshots as well as geometry: no clipped essential labels, overlapping controls or detached amount units. Header checks must include an active mempool badge and a connected wallet around navigation breakpoints.
- Keep canonical input independent of display formatting. Invalid drafts must remain visible and block submission. Never translate or format an editable amount into a different compose value.
- Keep translation provenance honest. Complete catalogs and passing tests do not imply native-speaker approval.

Incorrect transaction meaning introduced by a translation, misleading units, unusable controls and missing essential messages block release. Recheck the affected screens after a fix. Record remaining scope and evidence limits instead of starting an unrestricted rewrite.

## Terminology evidence

References were checked on 7–8 September 2026. These sources establish familiar vocabulary; their execution models do not override Counterparty Core.

| Audience | References used | Application |
| --- | --- | --- |
| Japanese | [Zaif order-book trading](https://zaif.jp/doc_orderbook_trading), [Zaif fees](https://zaif.jp/fee?lang=ja), user-provided Japanese community screenshots | Order types, fees and trading vocabulary; the screenshots support the existing ミント / ミント中 wording. |
| Simplified and Traditional Chinese | [Uniswap zh-CN](https://github.com/Uniswap/interface/blob/da6d36f71c4d2fd665b0aae1a052a4ffda917b31/packages/uniswap/src/i18n/locales/translations/zh-CN.json), [Uniswap zh-TW](https://github.com/Uniswap/interface/blob/da6d36f71c4d2fd665b0aae1a052a4ffda917b31/packages/uniswap/src/i18n/locales/translations/zh-TW.json), [UniSat zh-CN](https://github.com/unisat-wallet/extension/blob/5c58409b1066f7634910be67379a9cdeadf408b7/src/_locales/zh_CN/messages.json), [UniSat zh-TW](https://github.com/unisat-wallet/extension/blob/5c58409b1066f7634910be67379a9cdeadf408b7/src/_locales/zh_TW/messages.json) | Liquidity, slippage, minimum received, minting, confirmations, balances and fee rates. Existing Taiwan and Hong Kong distinctions remain. |
| Spanish | [Uniswap Spanish AMM explanation](https://blog.uniswap.org/es-ES/what-is-an-automated-market-maker) | Wallet, liquidity, order-book and slippage terminology. The regional URL alone does not justify duplicating the shared Spanish catalog. |
| Portuguese | [Uniswap Brazilian Portuguese AMM explanation](https://blog.uniswap.org/pt-BR/what-is-an-automated-market-maker) | Wallet, liquidity, swap, slippage and quote terminology. |
| French, Korean and Russian | Pinned Uniswap [French](https://github.com/Uniswap/interface/blob/da6d36f71c4d2fd665b0aae1a052a4ffda917b31/packages/uniswap/src/i18n/locales/translations/fr-FR.json), [Korean](https://github.com/Uniswap/interface/blob/da6d36f71c4d2fd665b0aae1a052a4ffda917b31/packages/uniswap/src/i18n/locales/translations/ko-KR.json) and [Russian](https://github.com/Uniswap/interface/blob/da6d36f71c4d2fd665b0aae1a052a4ffda917b31/packages/uniswap/src/i18n/locales/translations/ru-RU.json) catalogs | Ten transaction concepts compared: swap, limit orders, liquidity, slippage, price impact, minimum received, network fees, wallet, confirmation and insufficient balance. No misleading mismatch required changes. |
| Counterparty | [Counterwallet](https://github.com/CounterpartyXCP/counterwallet) and local Core revision `67e10db3e` | Historical Transifex terminology and current protocol semantics, respectively. |

Ukrainian received model-assisted review in component context using the existing glossary. The pinned Uniswap revision has no Ukrainian catalog, so no Uniswap corroboration is claimed for it. Reference coverage and speaker confidence are distinct: official product catalogs do not establish native approval of Launchpad's translations.

## Evidence for this pass

- All ten catalogs contain 1,238 keys. Source extraction, placeholders, rich text and machine-status checks pass. The only new source key is the complete mint-progress phrase; new text retains machine provenance.
- Contextual review covered selected main-journey keys in all ten locales. It did not freshly certify every catalog paragraph. Corrections distinguish pending quantities from transaction counts, minting from immediate receipt, seller BTC receipts from payments, and the wallet's LP balance from the pool's existence.
- The full suite passed 682 tests across 68 files, with type, lint and numeric checks. A subsequent focused run passed 32 tests after the expiry-label and swap-row fixes.
- The initial browser page matrix covered 120 localized routes at 360px and 1280px. After final scope and layout changes, 40 affected routes were rechecked at both widths without page errors or document overflow.
- Actual React component fixtures covered 800 locale/viewport/state cases across mint, swap, limit, liquidity, order tracking and connection. After the expiry and rate-row fixes, 320 affected swap/limit cases passed again. Sequential invalid `1e5` drafts remained visible and submission stayed disabled in all 80 original and 40 follow-up invalid cases.
- Screenshots were inspected in each language group. Automated geometry coverage is broader than manual image inspection. The offline fixture intermittently omitted the paint of an input value despite correct DOM state; affected Japanese/Korean inputs require an actual-site visual check rather than a speculative CSS change.
- Header measurements reproduced overlapping controls in 61 baseline cases. Telegram is now icon-only and the mempool badge shows its count, both retaining translated accessible names and hover titles. The shared full-navigation breakpoint moves from 880px to 1024px to fit translated labels and a connected wallet. All 858 final cases passed: eleven locales, thirteen widths, two wallet states and counts 0/1/999. The root review visually checked Spanish phone and desktop captures with a connected wallet and count 999.

Browser component fixtures use deterministic wallet, balance and quote data. They do not claim extension approval-screen coverage or a signed/broadcast transaction. Live release verification is recorded with the release PR.

## Remaining boundaries

Review is model-assisted, without native-speaker certification. A fluent user's task walkthrough remains stronger evidence of regional naturalness. The separate English explanation draft is not part of this release's acceptance. Changing the language URL still clears an unsaved form; changing number or fiat preferences preserves it. Extension localization remains a separate release.

## Context follow-up — 8 September 2026

The later FAQ and meme prototypes remain separate in [draft PR30](https://github.com/XCP/launchpad/pull/30). This follow-up starts from main `24bddfb`, including the profile's available-XCP and open-mint summary. It changes translations and translator context only; the English keys, FAQ, transaction logic and preference behavior are unchanged.

Review against the actual callers identified 47 value corrections across 13 keys in all ten translated catalogs:

- Count minting and payout addresses without implying independently identified people. Classic-fairminter summaries use count labels where necessary to accommodate one address as well as many.
- Identify cumulative MINTS programme rewards explicitly in profile labels and their explanation, rather than leaving them open to interpretation as investment profit. These totals are neither a current wallet balance nor necessarily already paid.
- Correct Japanese Activity's ordinary-pool LP label, which previously meant LP currently held; clarify Chinese LP redemption as removing liquidity to receive underlying assets.
- Correct a Japanese deadline clause, a Korean ongoing-mint modifier, and a Chinese Research explanation where a residual-balance threshold had been described as a considerable balance.

Fifteen context notes record the measured counts, reward-ledger meaning, LP operation and available/pending/escrowed XCP distinctions. The four new profile translations already express those balance distinctions correctly and require no value changes. Existing regional glossary choices, including shared Spanish and separate Chinese variants, remain appropriate for this bounded review.

All 1,242 keys remain present in every catalog. Placeholder parity and key order pass, status files are unchanged, and every changed entry retains machine provenance. The existing web type/lint/numeric checks and 71 focused localization, profile and compose-safety tests pass. This remains model-assisted contextual review, not native-speaker certification.

Some inherited English FAQ/Docs explanations describe pool XCP as permanently immobile. The initial LP restriction does not prevent swaps from paying assets out of the pool. Those source-copy concerns remain recorded with the parked explanation work; translations must not silently introduce a different claim in only one language. This follow-up does not certify or rewrite those paragraphs.
