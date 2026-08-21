const UNIT = 100_000_000n;
const MILLION_TOKENS_RAW = 1_000_000n * UNIT;
const OPENING_XCP_RAW = 690n * UNIT;
const OPENING_TOKEN_RAW = 31_000_000n * UNIT;
const FEE_DENOMINATOR = 10_000n;
const FEE_NUMERATOR = 9_950n;

export const PUBLIC_MILLIONS = 69;
export const MINT_XCP_PER_MILLION = 10;

export type PoolReserves = {
  xcpRaw: bigint;
  tokenRaw: bigint;
};

/** Exact integer form of counterparty-core's XCP-pair pool output formula. */
export function poolOutputRaw(
  reserveIn: bigint,
  reserveOut: bigint,
  input: bigint,
): bigint {
  if (input <= 0n) return 0n;
  return (
    (input * FEE_NUMERATOR * reserveOut) /
    (reserveIn * FEE_DENOMINATOR + input * FEE_NUMERATOR)
  );
}

export function openingReserves(): PoolReserves {
  return { xcpRaw: OPENING_XCP_RAW, tokenRaw: OPENING_TOKEN_RAW };
}

function tokensRawFromMillions(millions: number): bigint {
  if (!Number.isFinite(millions) || millions <= 0) return 0n;
  return BigInt(Math.round(millions * Number(MILLION_TOKENS_RAW)));
}

function fromRaw(raw: bigint): number {
  return Number(raw) / Number(UNIT);
}

export function sellIntoPool(
  reserves: PoolReserves,
  tokenMillions: number,
): { proceedsXcp: number; reserves: PoolReserves } {
  const input = tokensRawFromMillions(tokenMillions);
  const output = poolOutputRaw(reserves.tokenRaw, reserves.xcpRaw, input);
  return {
    proceedsXcp: fromRaw(output),
    reserves: {
      xcpRaw: reserves.xcpRaw - output,
      tokenRaw: reserves.tokenRaw + input,
    },
  };
}

/**
 * State after `count` independent full-cap minters each sell 1M tokens.
 * Repeating the trade matters slightly because every match floors to raw units.
 */
export function reservesAfterFullSellers(count: number): PoolReserves {
  let reserves = openingReserves();
  for (let i = 0; i < Math.max(0, Math.min(PUBLIC_MILLIONS, Math.floor(count))); i += 1) {
    reserves = sellIntoPool(reserves, 1).reserves;
  }
  return reserves;
}

/** Optimistic upper bound: one coordinated sale from the opening pool. */
export function coordinatedFirstExitProceedsXcp(controlledMillions: number): number {
  return sellIntoPool(openingReserves(), controlledMillions).proceedsXcp;
}

export function coordinatedFirstExitPnlXcp(
  controlledMillions: number,
  overheadXcpPerAddress = 0,
): number {
  return (
    coordinatedFirstExitProceedsXcp(controlledMillions) -
    controlledMillions * (MINT_XCP_PER_MILLION + overheadXcpPerAddress)
  );
}

/**
 * Selected scenario: some full bags sold first, then the controlled wallets
 * sell a chosen share together. Unsold tokens are deliberately valued at zero;
 * this is cash recovery, not marked portfolio value.
 */
export function scenarioCashFlow({
  controlledAddresses,
  priorFullSellers,
  sellShare,
  overheadXcpPerAddress,
}: {
  controlledAddresses: number;
  priorFullSellers: number;
  sellShare: number;
  overheadXcpPerAddress: number;
}) {
  const addresses = Math.max(1, Math.min(PUBLIC_MILLIONS, Math.floor(controlledAddresses)));
  const prior = Math.max(
    0,
    Math.min(PUBLIC_MILLIONS - addresses, Math.floor(priorFullSellers)),
  );
  const share = Math.max(0, Math.min(1, sellShare));
  const soldMillions = addresses * share;
  const before = reservesAfterFullSellers(prior);
  const sale = sellIntoPool(before, soldMillions);
  const capitalXcp = addresses * MINT_XCP_PER_MILLION;
  const overheadXcp = addresses * Math.max(0, overheadXcpPerAddress);
  return {
    addresses,
    prior,
    share,
    soldMillions,
    retainedMillions: addresses - soldMillions,
    capitalXcp,
    overheadXcp,
    proceedsXcp: sale.proceedsXcp,
    pnlXcpEquivalent: sale.proceedsXcp - capitalXcp - overheadXcp,
    poolXcpAfter: fromRaw(sale.reserves.xcpRaw),
  };
}

export function sequentialSellerProceedsXcp(position: number): number {
  const prior = Math.max(0, Math.min(PUBLIC_MILLIONS - 1, Math.floor(position) - 1));
  return sellIntoPool(reservesAfterFullSellers(prior), 1).proceedsXcp;
}

export function totalSequentialExitProceedsXcp(): number {
  const after = reservesAfterFullSellers(PUBLIC_MILLIONS);
  return fromRaw(OPENING_XCP_RAW - after.xcpRaw);
}

/**
 * If all 69 full bags sell and a wallet's positions are uniformly random,
 * symmetry gives this expectation exactly; it is not a behavioral forecast.
 */
export function randomOrderExpectedPnlXcp(
  controlledAddresses: number,
  overheadXcpPerAddress = 0,
): number {
  const addresses = Math.max(0, Math.min(PUBLIC_MILLIONS, controlledAddresses));
  const expectedProceeds = (totalSequentialExitProceedsXcp() / PUBLIC_MILLIONS) * addresses;
  return expectedProceeds - addresses * (MINT_XCP_PER_MILLION + overheadXcpPerAddress);
}

export function btcSatsToXcp(sats: number, btcUsd: number, xcpUsd: number): number {
  if (sats <= 0 || btcUsd <= 0 || xcpUsd <= 0) return 0;
  return ((sats / 100_000_000) * btcUsd) / xcpUsd;
}

export function continuousThresholds(overheadXcpPerAddress = 0) {
  const cost = MINT_XCP_PER_MILLION + Math.max(0, overheadXcpPerAddress);
  const feeFactor = 0.995;
  const optimum =
    (Math.sqrt((690 * feeFactor * 31) / cost) - 31) / feeFactor;
  const breakEven = 690 / cost - 31 / feeFactor;
  return { optimum, breakEven };
}
