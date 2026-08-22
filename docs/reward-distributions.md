# MINTS reward distributions

This is the operating contract for the MINTS mint reward. The database and UI
are designed around one distinction:

- **Lifetime earned** is cumulative programme accounting: eligible mint
  transactions × 100 MINTS. It never decreases when someone sends or sells
  MINTS and is not their wallet balance.
- **Awaiting next batch** is lifetime earned minus rewards already attached to
  broadcast or confirmed transactions.
- **Confirming** is attached to a broadcast transaction that is not confirmed.
- **Paid** is attached to a confirmed transaction.

A profile's Rewards tab and the global Distributions section appear only after
there is a real transaction to link. A draft or frozen manifest is never shown
as a payment.

## Eligibility and cutoffs

The programme rewards the first 10,000 mint transactions on conforming XCP-69
launches. Ordering is deterministic:

1. `block_index`
2. Counterparty `tx_index`
3. `tx_hash` as the final stable tie-break

The address filter is applied **after** the first 10,000 are selected. Applying
it before the cap would accidentally give each address a separate 10,000-mint
allowance.

The intended first distribution is mints 1–1,000. A frozen batch records its
first and last programme mint numbers, the exact cutoff transaction, every
included mint tx, each address's aggregate entitlement, and a SHA-256 of the
canonical manifest. `reward_batch_mints.mint_tx_hash` is globally unique, so a
mint cannot be included in two batches.

## Safe payout sequence

1. Wait until the intended cutoff transaction is confirmed and indexed.
2. Produce a canonical manifest sorted by address containing each address,
   eligible mint count, and raw MINTS quantity. Save the human-readable JSON
   and its SHA-256 outside D1 as well.
3. Verify the invariants below, then freeze the batch in `reward_batches`,
   `reward_batch_mints`, and `reward_payouts`. Every payout starts with a NULL
   `reward_tx_hash`; freezing does not make anything public.
4. Compose from that immutable manifest. Prefer one MPMA for compatible
   recipients and individual enhanced sends where MPMA cannot encode the
   destination. All of those transactions share the same internal batch id.
5. Before signing, decode the unsigned transactions and reconcile every
   destination and raw quantity against the manifest. Never rely on the UI's
   rounded display values.
6. Broadcast, insert each transaction into `reward_transactions`, and link the
   corresponding payout rows. Set those rows to `broadcast`. This is when the
   transaction-backed public history appears.
7. After confirmation, record the block and mark transaction/payout rows
   `confirmed`. Mark the batch confirmed only when every intended recipient is
   confirmed.
8. If a transaction fails or is replaced, retain it as audit history with that
   status and link the payout to the replacement. Failed/replaced transactions
   are not displayed as paid.

The sending wallet's asset balance is operational state, never evidence of who
earned what. The frozen manifest and confirmed transactions are the evidence.

## Reconciliation invariants

Before broadcast:

- batch mint count = `cutoff_mint_number - first_mint_number + 1`
- no `mint_tx_hash` exists in another reward batch
- each address quantity = its batch mint count × 10,000,000,000 raw MINTS
- sum of address mint counts = batch eligible mint count
- sum of address quantities = `total_quantity`
- manifest SHA-256 matches the stored digest
- composed transaction destinations and raw quantities equal the manifest

After broadcast/confirmation:

- every payout is linked to exactly one current reward transaction
- every transaction belongs to the same batch as its linked payouts
- sum of linked payout quantities = batch total
- all linked transactions are confirmed before the batch is confirmed
- BTC miner fees are recorded separately from MINTS paid

MPMA may create recoverable bare-multisig satoshis. Record those in
`recoverable_sats` and record actual miner cost in `btc_fee_sats`; recovery is
a later treasury transaction and does not alter recipient rewards.

## Public presentation

The profile card always says **Lifetime earned**, never balance. Before a
distribution it says no distribution has been sent. Once a transaction exists,
the conditional Rewards tab separates lifetime earned, paid, confirming, and
awaiting, then links every payout transaction to xcp.io.

The `/rewards` page follows the same rule: its Distributions section is absent
until at least one batch has a broadcast or confirmed transaction. One batch
may show multiple links when it used a hybrid MPMA/individual-send payout.
