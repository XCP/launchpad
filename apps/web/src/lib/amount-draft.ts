import { COUNTERPARTY_MAX_INT, parseAmountDraft } from "@xcp/wallet-sdk/amounts";

/** User drafts never go through the arithmetic parser, which intentionally rounds. */
export function parseAmountRaw(draft: string, decimals: 0 | 8 = 8): bigint | null {
  const result = parseAmountDraft(draft, { decimals, minRaw: 0n, maxRaw: COUNTERPARTY_MAX_INT });
  return result.status === "valid" ? result.raw : null;
}

/** A divisible token sold in whole-token lots still uses eight raw places. */
export function parseWholeTokenRaw(draft: string): bigint | null {
  const result = parseAmountDraft(draft, { decimals: 0, maxRaw: COUNTERPARTY_MAX_INT / 100_000_000n });
  return result.status === "valid" ? result.raw * 100_000_000n : null;
}

/** Only bounded, validated settings become doubles; token quantities stay bigint. */
export function parseBoundedSetting(draft: string, max: number, min = 0, decimals: 0 | 8 = 8) {
  const result = parseAmountDraft(draft, {
    decimals,
    minRaw: BigInt(Math.round(min * 10 ** decimals)),
    maxRaw: BigInt(Math.round(max * 10 ** decimals)),
  });
  return {
    empty: draft === "",
    valid: draft === "" || result.status === "valid",
    value: result.status === "valid" ? Number(result.canonical) : null,
  };
}

/** Single-line HTML inputs remove control characters before change events.
 * Keep pasted/dropped controls visible as escapes, so they remain invalid. */
export function visibleDraft(text: string): string {
  return text.replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t");
}
