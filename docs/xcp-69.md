# 🍆 XCP-69 Standard

XCP-69 is a fixed-parameter token launch standard built on Counterparty **fairmint
pools** (protocol feature `fairmint_pool`, active on mainnet since block 961,100 /
2026-08-05, core v11.2.0). It replaces the pre-protocol draft of this document: the
"platform operator" role described there no longer exists. Every guarantee below is
enforced by consensus, not by a website.

Where 🌿 XCP-420 is a burn-based standard for low-stakes launches, XCP-69 is
all-or-nothing with pooled liquidity: either the community fully funds the launch
and trading opens instantly against locked liquidity, or everyone gets their XCP
back.

## 🔒 What the protocol guarantees

- **All-or-nothing.** The soft cap equals the entire public supply. There is no
  partial success: the launch sells out, or it refunds. This is a consensus rule,
  not site policy — core rejects any pool fairminter whose soft cap does not equal
  its mintable supply (`hard_cap − premint − pool_quantity`).
- **The creator receives none of the raised XCP.** Every satoshi of XCP paid by
  minters is deposited into the TOKEN/XCP AMM pool at close.
- **Liquidity is locked forever.** The pool's LP tokens are minted directly to the
  unspendable address. Nobody — creator included — can ever withdraw the liquidity.
  A rug pull is not mitigated; it is unavailable.
- **No premine, no commission.** The creator mints on the same terms as everyone
  else, subject to the same 10 XCP per-address cap.
- **No stealth launches.** Every launch confirms on-chain *before* its
  `start_block`. While the fairminter is `pending`, consensus rejects every mint —
  the creator cannot front-run their own community. The full, immutable terms are
  publicly inspectable before the first lot can be bought.
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
| Start | a **future** block — the pre-announcement window | `start_block: <a block after confirmation>` |
| Mint window | exactly 1,000 blocks (~7 days) from start | `soft_cap_deadline_block: <start_block + 1000>` |
| End | unset — pool fairminters close at the deadline | `end_block: 0` |
| Premine | none | `premint_quantity: 0` |
| Commission | none | `minted_asset_commission: 0` |
| Supply lock | locked at close | `lock_quantity: true` |
| Description lock | locked at close | `lock_description: true` |
| Payment | XCP payment (never burn) | `burn_payment: false` |

Raw values are satoshi units (×10⁸). `pool_quantity` and `max_mint_per_address`
have no `_normalized` form in the API — divide by 10⁸ for display.

**House style vs. conformance.** Two fields are deliberately NOT part of the
standard, so other platforms can launch strictly-conforming XCP-69 without
adopting this site's conventions:

- **`lp_asset`** — conformance requires only a valid, unissued numeric asset
  chosen with real randomness (front-running protection). The `69…69`,
  ≡ 69 (mod 97) format is this site's signature, verifiable but optional.
- **`description`** — conformance never inspects it. This site points it at
  hosted asset-info JSON (or an on-chain inscription); it is creative
  surface, not protocol.

Everything in the table above is strictly enforced — exact equality against
the fairminter record, no exceptions.

## ⏱️ Timing

Two rules, one goal: **every launch is announced before it is mintable, and every
sale has the same bounded clock.**

1. **Pre-announcement.** The launch transaction must confirm strictly before
   `start_block`. Consensus does not require this — a fairminter confirming at or
   past its start simply opens instantly — so the requirement lives in the
   conformance predicate: `start_block > block_index` (the confirmation block).
   The guarantee it buys is real: consensus rejects fairmints against a `pending`
   fairminter, so the announcement window is provably mint-proof. No exact lead
   time is mandated because none is composable — a creator cannot know their
   confirmation block in advance. Compose with enough lead for your transaction
   to confirm; a launch that confirms after its start block is valid to core but
   is **not XCP-69**. This is the clause doing the real work: without it, a
   creator could compose a nominal 1,000-block sale and simply broadcast it
   late — confirming a block or two before its own deadline and running a
   near-instant insider mint behind thousand-block metadata. Conformance reads
   the clock from the chain, not from the composed values.
2. **The window.** `soft_cap_deadline_block − start_block = 1000`, exactly.
   `end_block` is 0: pool fairminters close at the soft-cap deadline by protocol,
   so an end block is dead weight.

   Why 1,000 (~a week): the window only ever delays *failure*. A sell-out
   settles the moment it fills, so winners never wait out the tail — the length
   is purely a bound on how long a dud can hold minters' XCP, and a week is
   about the most that's worth asking. Long enough for 69 strangers to find a
   launch; short enough that a miss frees everyone's capital within days.

**The rewrite caveat (integration-critical).** When a launch sells out before the
deadline, core *rewrites* `soft_cap_deadline_block` to the fill block and settles
the pool in that block's end-of-block phase. On a `closed` record the field
therefore holds the **settlement block**, not the composed deadline. Consequences:

- Countdown UIs may only trust the field while status is `open`.
- Against the fairminter row alone, the window check is exact
  (`= start + 1000`) for `pending`/`open` records and can only be
  `≤ start + 1000` for `closed` ones. The composed value is not lost, though:
  the `NEW_FAIRMINTER` event
  (`GET /v2/transactions/<tx_hash>/events/NEW_FAIRMINTER`) preserves the
  original bindings append-only — the sell-out rewrite arrives as a separate
  `FAIRMINTER_UPDATE` event. Verifiers restore exact equality for closed
  launches by checking the event's `soft_cap_deadline_block == start_block +
  1000`; this site does exactly that, so a short-windowed launch cannot wear
  the badge even after graduating.

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

1. **Scheduled** — the launch is confirmed on-chain but `start_block` has not
   arrived; status is `pending`. The 31M pool reserve is already escrowed at the
   unspendable address. Consensus rejects all mints. This is the announcement
   window.
2. **Launching** — `start_block` arrives; status flips to `open`. Mints are whole
   lots, escrowed (both the XCP and the tokens) at the unspendable address until
   resolution. The window closes at `soft_cap_deadline_block`, or earlier the
   moment the supply sells out.
3. **Launched** — sold out at or before the deadline: escrow releases, minters
   receive tokens, all 690 XCP + 31M tokens seed the AMM pool, LP is minted to the
   unspendable address, supply and description lock. Trading is live in the same
   block's resolution phase.
4. **Refunded** — soft cap missed at the deadline: every minter's XCP is returned
   and the entire escrowed supply is destroyed (`destructions` tag:
   `"soft cap not reached"`). The asset records remain on-chain as history.

## 🛠️ Composing a launch

`GET /v2/addresses/<issuer>/compose/fairminter` with the raw values from the
table (plus `sat_per_vbyte`; add `verbose=true` for a PSBT). The node returns an
**unsigned** transaction — sign and broadcast with your own wallet. Notes that
save integrators real pain:

- **Issuer's on-ledger XCP:** the 0.5 XCP named-asset registration fee **plus**
  the pooldeposit gas fee (`GET …/compose/pooldeposit/estimatexcpfees`, currently
  0, usage-priced) must be on the issuer's Counterparty balance. Both debit at
  confirmation; settlement at close is prepaid.
- **`lp_asset` must be genuinely random.** Numeric assets are free to issue, and
  the name is validated as unissued at *parse* time — a predictable name can be
  front-run between broadcast and confirmation, invalidating the launch. While a
  launch is live its `lp_asset` is earmarked: consensus blocks anyone from
  issuing it or claiming it in another fairminter.
- **The house LP format** (what this site's form generates): an 18-digit numeric
  asset that starts with `69`, ends with `69`, and is ≡ 69 (mod 97) — one modulo
  verifies membership, IBAN-style, and ~10¹² such names exist. Informative, not
  normative: conformance never tests the LP name, and anyone can generate
  passing names — the format identifies the style, not the author.
- **Minting** is `GET /v2/addresses/<minter>/compose/fairmint` with `quantity` in
  raw token units (whole lots). The XCP price (`ceil(quantity / lot × price)`) is
  debited from the minter's **on-ledger XCP balance** — a funded BTC wallet with
  no XCP fails compose with "insufficient XCP balance". Per-address allowance can
  be used across multiple transactions.

## ✅ Conformance

There is no on-chain marker for XCP-69. Conformance is verified field-by-field
against the fairminter record; this site lists only conforming launches:

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
        and fm["max_mint_per_tx"] == 100000000000000
        and fm["premint_quantity"] == 0
        and (fm["minted_asset_commission_int"] or 0) == 0
        and bool(fm["lock_quantity"]) and bool(fm["lock_description"])
        and bool(fm["divisible"]) and not fm["burn_payment"]
        and not fm["asset"].startswith("A")          # named assets only
        # timing: scheduled start, fixed window, no end_block
        and fm["start_block"] > 0
        and fm["end_block"] == 0
        and fm["start_block"] > fm["block_index"]    # confirmed before start
        and (
            fm["soft_cap_deadline_block"] <= fm["start_block"] + 1000
            if fm["status"] == "closed"              # deadline rewritten on early fill
            else fm["soft_cap_deadline_block"] == fm["start_block"] + 1000
        )
    )
```

Exact equality, not ranges — with two deliberate, documented inequalities in the
timing clauses (see ⏱️ Timing). The commission check matters: the protocol permits
skimming up to 99% of each mint to the creator, which is a premine with extra
steps; XCP-69 forbids it. The `max_mint_per_tx` check matters for the same reason
in miniature: without it a launch could force one-lot transactions and grief its
own minters.

## ⚠️ Honest limitations

- The per-address cap is sybil-resistant in cost only, not in principle.
- Refunds return XCP quantity, not fiat value.
- The 2.23× opening premium is structural, not a price guarantee — the pool floor
  decays as people sell into it.
- Token media is off-chain **by default**: the chain carries the asset-info JSON's
  URL permanently (`lock_description`), not its content. The hosted content is
  curatable by the asset's current on-chain owner (edits are gated by a BIP-322
  wallet signature). Creators can opt out of the dependency entirely by
  inscribing the image on-chain as the description (ord envelope; the fairminter
  message rides in the inscription metadata and the image becomes the
  consensus-permanent description). Either way, nothing economic — supply, pool,
  refunds — depends on hosted content.
- The pre-announcement rule guarantees a mint-proof window exists, not how long it
  is — one block of lead conforms. Interfaces should surface the gap between
  confirmation and start so a one-block "announcement" is visible for what it is.

---

🔗 See also: [PLAN.md](../PLAN.md)
