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
