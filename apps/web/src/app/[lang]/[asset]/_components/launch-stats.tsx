"use client";

import useSWR from "swr";
import { fetchJson } from "@/lib/client";
import { useDenomination, setDenomination } from "@/lib/denomination";
import { fromSats } from "@/lib/format";
import type { Raw } from "@/lib/numeric";
import { useFiat } from "@/lib/currency";
import { useT } from "@/lib/i18n/client";
import { useNumbers } from "@/lib/i18n/numbers";
import {
  XCP69,
  XCP69_RAISE_SATS,
} from "@/lib/xcp69";

import type { AddressSummary } from "@/components/address-hover-card";
import { LABEL, FOCUS } from "@/components/ui/tokens";
import { SATS } from "@/lib/numeric";
import { XCP_API_BASE } from "@/lib/constants";

export function TermsStrip({ xcpUsd }: { xcpUsd: number | null }) {
  const num = useNumbers();
  const t = useT();
  const usd = useFiat();
  const denom = useDenomination();
  const usdMode = denom === "USD" && !!xcpUsd;
  const rate = xcpUsd ?? 0;

  const priceXcp = XCP69.PRICE / SATS; // 0.01 XCP per lot
  const lot = XCP69.QUANTITY_BY_PRICE / SATS; // 1,000 tokens
  const capXcp = XCP69.MAX_MINT_PER_ADDRESS / XCP69.QUANTITY_BY_PRICE * priceXcp;
  const capTokens = XCP69.MAX_MINT_PER_ADDRESS / SATS;
  const targetXcp = XCP69_RAISE_SATS / SATS;
  const supplyTokens = XCP69.HARD_CAP / SATS;
  const poolTokens = XCP69.POOL_QUANTITY / SATS;
  // Valued at the price the pool opens to — the first price the market
  // actually quotes, which is where the launch's market cap starts.
  const openPriceXcp = targetXcp / poolTokens;
  const mcapXcp = supplyTokens * openPriceXcp;
  // A pool is worth both its legs, and the launch funds them equally.
  const liquidityXcp = targetXcp * 2;

  const cells: [string, string][] = usdMode
    ? [
        [t("Price"), `${usd(priceXcp * rate)} / ${num.commas(lot)}`],
        [
          t("Per address"),
          t("{amount} · {tokens} max", { amount: usd(capXcp * rate), tokens: num.compact(capTokens) }),
        ],
        [t("Target"), t("{amount} or refund", { amount: usd(targetXcp * rate) })],
        [
          t("Market cap"),
          t("{cap} · {liquidity} pool", {
            cap: usd(mcapXcp * rate),
            liquidity: usd(liquidityXcp * rate),
          }),
        ],
      ]
    : [
        [t("Price"), `${num.commas(priceXcp)} XCP / ${num.commas(lot)}`],
        [
          t("Per address"),
          t("{amount} · {tokens} max", { amount: `${capXcp} XCP`, tokens: num.compact(capTokens) }),
        ],
        [t("Target"), t("{amount} or refund", { amount: `${num.commas(targetXcp)} XCP` })],
        [
          t("Supply"),
          t("{supply} · {pool} pool", { supply: num.compact(supplyTokens), pool: num.compact(poolTokens) }),
        ],
      ];

  return (
    <div className="mt-5 border-t border-gray-100 dark:border-gray-800 pb-4 pt-2">
      {/* Four columns only once the card is wide enough for them: at the sm
          breakpoint the card is still 640px and the last value wraps. */}
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {cells.map(([label, value], i) => (
          <div key={label}>
            <div className="flex items-start justify-between gap-2">
              <dt className={LABEL}>{label}</dt>
              {/* The toggle rides the last label, not the values — a value
                  that wraps to two lines would otherwise drag it out of
                  line with the row. */}
              {/* Two columns on a phone, four above it — so the toggle
                  belongs to a different cell at each width to stay on the
                  end of the first row. */}
              {xcpUsd !== null && (i === 1 || i === cells.length - 1) && (
                <button
                  type="button"
                  onClick={() => setDenomination(usdMode ? "XCP" : "USD")}
                  aria-label={usdMode ? t("Show amounts in XCP") : t("Show amounts in US dollars")}
                  className={`relative shrink-0 rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-1.5 py-0.5 text-[7px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 transition-colors after:absolute after:-inset-x-2 after:-inset-y-3 after:content-[''] hover:border-purple-400 dark:hover:border-purple-500 hover:text-purple-600 dark:hover:text-purple-400 active:scale-95 ${FOCUS} ${
                    i === 1 ? "md:hidden" : "hidden md:block"
                  }`}
                >
                  {usdMode ? "XCP" : "USD"}
                </button>
              )}
            </div>
            <dd className="mt-0.5 text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100">
              {value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ---------- hosted metadata (site-issued launches) ---------- */

/**
 * Which of a sale's minters the explorer has never seen do anything on
 * chain — a batch of such addresses is the sybil pattern the per-address cap
 * can't catch on its own. Capped to the `addresses` the caller passes in
 * (the page on screen, in practice) and fetched lazily, client-side, once
 * per mount: this is the same shape as the issuer hover card, not a repeat
 * of the SSR fan-out the index page used to do. Callers sharing the same
 * address list hit the same SWR cache entry.
 *
 * "No history" is the explorer's own verdict — no first_block, nothing on
 * chain, ever — and nothing else. It used to also cover any address first
 * seen within 90 days, which described wallets with a dozen balances and
 * forty trades as having no history. Age is not a finding; absence is.
 */
export function useAddressFreshness(addresses: string[]) {
  const capped = addresses.slice(0, 25);
  return useSWR(
    capped.length > 0 ? ["no-history-minters", capped.join(",")] : null,
    async () => {
      const summaries = await Promise.all(
        capped.map((addr) =>
          fetchJson(`${XCP_API_BASE}/addresses/${addr}/summary`)
            .then((d: { result: AddressSummary | null }) => d.result)
            .catch(() => undefined),
        ),
      );
      // A failed lookup is not evidence of anything; only an answer counts.
      const noHistory = new Set<string>();
      let known = 0;
      capped.forEach((addr, i) => {
        const s = summaries[i];
        if (s === undefined) return;
        known++;
        if (!s?.first_block) noHistory.add(addr);
      });
      return { noHistory, known };
    },
    { revalidateOnFocus: false },
  ).data;
}

/** Distinct addresses that have minted. Individual no-history addresses
 *  are already flagged in the table below, so the count here doesn't
 *  repeat that — just how many, in plain terms. */
export function ParticipantsStat({ participants }: { participants: number }) {
  const num = useNumbers();
  const t = useT();
  return (
    <div>
      <div className={LABEL}>{t("Holders")}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100">
        {t("{n} addresses", { n: num.commas(participants) })}
      </div>
    </div>
  );
}

/** The small XCP/USD pill. One global denomination, but the button itself
 *  lives on a different stat cell depending on breakpoint (desktop: Deadline,
 *  the last cell in the row; mobile: TX fees, the end of the first row) —
 *  same technique TermsStrip uses, ported here so the button never renders
 *  twice at once. Callers decide whether to render it at all (gated on
 *  their own rate's availability); this component only handles placement. */
export function DenomToggle({ visibleOn }: { visibleOn: "mobile" | "desktop" }) {
  const t = useT();
  const denom = useDenomination();
  const usdMode = denom === "USD";
  return (
    <button
      type="button"
      onClick={() => setDenomination(usdMode ? "XCP" : "USD")}
      aria-label={usdMode ? t("Show amounts in XCP") : t("Show amounts in US dollars")}
      className={`relative shrink-0 rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 px-1.5 py-0.5 text-[7px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400 transition-colors after:absolute after:-inset-x-2 after:-inset-y-3 after:content-[''] hover:border-purple-400 dark:hover:border-purple-500 hover:text-purple-600 dark:hover:text-purple-400 active:scale-95 ${FOCUS} ${
        visibleOn === "mobile" ? "sm:hidden" : "hidden sm:block"
      }`}
    >
      {usdMode ? "XCP" : "USD"}
    </button>
  );
}

/** Raised, in whichever denomination the site-wide toggle is set to — one
 *  value shown at a time, not XCP-and-USD side by side. The toggle button
 *  itself now lives elsewhere (see DenomToggle); this just responds to it. */
export function RaisedStat({
  paidQuantity,
  xcpUsd,
  progress,
}: {
  paidQuantity: Raw | null;
  xcpUsd: number | null;
  /** Sale progress in [0, 1] — a share of the raise, not of the wallet. */
  progress: number;
}) {
  const num = useNumbers();
  const t = useT();
  const usd = useFiat();
  const denom = useDenomination();
  const usdMode = denom === "USD" && xcpUsd !== null;
  return (
    <div>
      <div className={LABEL}>{t("Raised")}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100">
        {usdMode
          ? usd(fromSats(paidQuantity) * (xcpUsd as number))
          : `${num.commasRaw(paidQuantity)} XCP`}
        {" · "}
        {num.percent(progress)}
      </div>
    </div>
  );
}

/** Bitcoin-side cost of the launch's mints so far — sats by default, USD
 *  when the site-wide toggle is on and a BTC/USD rate is available. Hosts
 *  the denom toggle on mobile (see DenomToggle's own doc comment). */
export function TxFeesStat({
  totalFeeSats,
  btcUsd,
}: {
  totalFeeSats: number;
  btcUsd: number | null;
}) {
  const num = useNumbers();
  const t = useT();
  const usd = useFiat();
  const denom = useDenomination();
  const usdMode = denom === "USD" && btcUsd !== null;
  return (
    <div>
      <div className="flex items-start justify-between gap-2">
        <div className={LABEL}>{t("TX fees")}</div>
        {btcUsd !== null && <DenomToggle visibleOn="mobile" />}
      </div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100">
        {usdMode
          ? usd(fromSats(totalFeeSats) * (btcUsd as number))
          : t("{n} sats", { n: num.commas(totalFeeSats) })}
      </div>
    </div>
  );
}
