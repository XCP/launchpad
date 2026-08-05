# 🍆 XCP-69 Standard

XCP-69 is a fixed-parameter token launch standard built on Counterparty **fairmint
pools** (protocol feature `fairmint_pool`, active on mainnet since block 961,100 /
2026-08-05, core v11.2.0). It replaces the pre-protocol draft of this document: the
"platform operator" role described there no longer exists. Every guarantee below is
enforced by consensus, not by a website.

Where [🌿 XCP-420](./xcp-420.md) is a burn-based standard for low-stakes launches,
XCP-69 is all-or-nothing with pooled liquidity: either the community fully funds the
launch and trading opens instantly against locked liquidity, or everyone gets their
XCP back.

## 🔒 What the protocol guarantees

- **All-or-nothing.** The soft cap equals the entire public supply. There is no
  partial success: the launch sells out, or it refunds.
- **The creator receives none of the raised XCP.** Every satoshi of XCP paid by
  minters is deposited into the TOKEN/XCP AMM pool at close.
- **Liquidity is locked forever.** The pool's LP tokens are minted directly to the
  unspendable address. Nobody — creator included — can ever withdraw the liquidity.
  A rug pull is not mitigated; it is unavailable.
- **No premine, no commission.** The creator mints on the same terms as everyone
  else, capped at 1% like everyone else.
- **Refunds are automatic.** If the soft cap is missed at the deadline, the protocol
  refunds every minter's XCP and destroys the escrowed supply in the same block.
- **Anti-sandwich resolution.** Even a hard-cap fill resolves at end-of-block, so the
  pool can never be traded against in the transaction that creates it.

## 🔑 Parameters

One parameter set. No variations. A launch either matches every row or it is not
XCP-69.

| Parameter | Value | Raw (compose) |
|---|---|---|
| Asset | **named** asset (no numerics), divisible | `divisible: true` |
| Supply (hard cap) | 100,000,000 | `hard_cap: 10000000000000000` |
| Public sale (soft cap) | 69,000,000 | `soft_cap: 6900000000000000` |
| Pool reserve | 31,000,000 | `pool_quantity: 3100000000000000` |
| Lot size | 1,000 tokens | `quantity_by_price: 100000000000` |
| Price | 0.01 XCP per lot | `price: 1000000` |
| Per-address cap | 1,000,000 tokens (10 XCP) | `max_mint_per_address: 100000000000000` |
| Per-tx cap | same as per-address | `max_mint_per_tx: 100000000000000` |
| Mint window | 1,000 blocks (~7 days) | `soft_cap_deadline_block: <creation + 1000>` |
| Start / end | immediate / unset | `start_block: 0`, `end_block: 0` |
| Premine | none | `premint_quantity: 0` |
| Commission | none | `minted_asset_commission: 0` |
| Supply lock | locked at close | `lock_quantity: true` |
| Description lock | locked at close | `lock_description: true` |
| Payment | XCP payment (never burn) | `burn_payment: false` |
| Description | URL of hosted asset-info JSON | `description: "https://…/<ASSET>.json"` |
| LP asset | `A69` + random numeric tail | `lp_asset: "A69…"` |

Raw values are satoshi units (×10⁸). `pool_quantity` and `max_mint_per_address`
have no `_normalized` form in the API — divide by 10⁸ for display.

## 📐 What the numbers produce

- **Raise:** exactly **690 XCP** on success (69M ÷ 1,000 lots × 0.01 XCP). Exact,
  not approximate — mints are whole lots, so no rounding exists.
- **Participation floor:** at 10 XCP max per address, success requires **at least
  69 distinct addresses**. (Historically, launches with 100+ buyers survive six
  months ~98% of the time; 1–4 buyers, 0%.) The cap is per address, not per person —
  it raises the cost of faking a crowd, it cannot prevent one.
- **Pool opening price:** 690 XCP against 31M tokens =
  **69/31 ≈ 2.23× the mint price**. Every minter is structurally in profit at open;
  the pool, not later buyers, absorbs early exits.
- **Depth at open:** ~690 XCP of real, permanently locked liquidity; constant
  50 bps swap fee (XCP pair).
- **Allocation:** 69% of supply publicly minted, 31% in the pool. They sum to 100% —
  there is nowhere else for supply to be.

## 🔄 Lifecycle

1. **Launching** — fairminter is `open`. Mints are whole lots, escrowed (both the
   XCP and the tokens) at the unspendable address until resolution. Window closes at
   `soft_cap_deadline_block`, or earlier the moment the supply sells out.
2. **Launched** — sold out at or before the deadline: escrow releases, minters
   receive tokens, all 690 XCP + 31M tokens seed the AMM pool, LP is minted to the
   unspendable address, supply and description lock. Trading is live in the same
   block's resolution phase.
3. **Refunded** — soft cap missed at the deadline: every minter's XCP is returned
   and the entire escrowed supply is destroyed (`destructions` tag:
   `"soft cap not reached"`). The asset records remain on-chain as history.

## ✅ Conformance

There is no on-chain marker for XCP-69. Conformance is verified field-by-field
against the fairminter record; xcp.fun lists only conforming launches:

```python
def is_xcp69(fm):  # raw integer fields
    return (
        fm["status"] in ("pending", "open", "closed")
        and fm["pool_quantity"] == 3100000000000000
        and fm["soft_cap"] == 6900000000000000
        and fm["hard_cap"] == 10000000000000000
        and fm["quantity_by_price"] == 100000000000
        and fm["price"] == 1000000
        and fm["max_mint_per_address"] == 100000000000000
        and fm["premint_quantity"] == 0
        and (fm["minted_asset_commission_int"] or 0) == 0
        and bool(fm["lock_quantity"]) and bool(fm["lock_description"])
        and bool(fm["divisible"]) and not fm["burn_payment"]
        and not fm["asset"].startswith("A")          # named assets only
    )
```

Exact equality, not ranges: the standard's value is that every launch is identical.
The commission check matters — the protocol permits skimming up to 99% of each mint
to the creator, which is a premine with extra steps; XCP-69 forbids it.

## ⚠️ Honest limitations

- The per-address cap is sybil-resistant in cost only, not in principle.
- Refunds return XCP quantity, not fiat value.
- The 2.23× opening premium is structural, not a price guarantee — the pool floor
  decays as people sell into it.
- Token image/description JSON is hosted off-chain (the chain carries only its URL,
  permanently, via `lock_description`).

---

🔗 See also: [🌿 XCP-420 Standard](./xcp-420.md) · [PLAN.md](../PLAN.md)
