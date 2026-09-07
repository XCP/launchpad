/**
 * USD → other currencies, for a visitor who thinks in yen or euros.
 *
 * Every dollar figure on the site is XCP × the XCP/USD mark, so a second
 * currency is one more factor on the end — and the factor comes from here.
 * The European Central Bank's daily reference rates, via Frankfurter, which
 * needs no key and moves once a business day. That is the right cadence: a
 * memecoin's price moves by the minute, the euro does not, and a rate that
 * is a day old is invisible against the other leg.
 */
const FX_URL = "https://api.frankfurter.dev/v1/latest?base=USD";

export interface FxRates {
  base: "USD";
  /** The ECB publication day the rates are for. */
  date: string;
  /** Units of each currency per one US dollar. */
  rates: Record<string, number>;
}

/** Null on any failure. A visitor whose rates cannot be fetched sees dollars,
 *  which is what they saw before this existed, rather than an error. */
export async function fetchFxRates(): Promise<FxRates | null> {
  try {
    const res = await fetch(FX_URL, {
      signal: AbortSignal.timeout(6_000),
      cf: { cacheTtl: 3_600, cacheEverything: true },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      base?: unknown;
      date?: unknown;
      rates?: Record<string, unknown>;
    };
    if (body.base !== "USD" || typeof body.date !== "string" || !body.rates) return null;
    const rates: Record<string, number> = {};
    for (const [code, rate] of Object.entries(body.rates)) {
      if (/^[A-Z]{3}$/.test(code) && typeof rate === "number" && Number.isFinite(rate) && rate > 0) {
        rates[code] = rate;
      }
    }
    return Object.keys(rates).length > 0 ? { base: "USD", date: body.date, rates } : null;
  } catch {
    return null;
  }
}
