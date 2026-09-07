"use client";

import { ComposeError } from "@/components/compose-error";

import { AmountInput } from "@/components/amount-input";
import { parseBoundedSetting } from "@/lib/amount-draft";

import { LazyLink } from "@/components/lazy-link";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { AssetChip } from "@/components/asset-chip";
import { ConnectButton } from "@/components/connect-button";
import { CTA } from "@/components/ui/button";
import { TxLink } from "@/components/ui/confirm-card";
import { BalanceUnavailable } from "@/components/ui/balance-unavailable";
import { ErrorBanner } from "@/components/ui/error-banner";
import { Well } from "@/components/ui/well";
import { fetchBtcUsd } from "@/lib/api/price-client";
import { fetchFairmintersByAsset } from "@/lib/api/counterparty";
import { fetchAddressFairmints } from "@/lib/client";
import { fetchMempoolSnapshot } from "@/lib/api/launchpad-api";
import { useFiat } from "@/lib/currency";
import { useT } from "@/lib/i18n/client";
import { useNumbers } from "@/lib/i18n/numbers";
import { approx, big } from "@/lib/numeric";
import { trackTx } from "@/lib/analytics";
import {
  fetchFeeRate,
  registerPending,
} from "@xcp/wallet-sdk";
import { useSpendableBalance } from "@xcp/wallet-sdk/react/use-spendable-balance";
import { isBusy } from "@/hooks/use-busy";
import { useCompose } from "@/lib/wallet/useCompose";
import { useWallet } from "@/lib/wallet/wallet-context";
import { remainingLotsForAddress, saleTarget, xcp69Params, XCP69 } from "@/lib/xcp69";

const SATS = 1e8;
const MINT_VBYTES = 250;
const TOKENS_PER_LOT = XCP69.QUANTITY_BY_PRICE / SATS; // 1,000
const MAX_LOTS = XCP69.MAX_MINT_PER_ADDRESS / XCP69.QUANTITY_BY_PRICE; // 1,000
const XCP_PER_LOT = XCP69.PRICE / SATS; // 0.01
const SUPPLY_TOKENS = 100_000_000;
/** Token presets; 1M = the 10 XCP max mint. */
const PRESETS = [10_000, 100_000, 1_000_000];

/** Fixed-lot mint in the house grammar: receive/pay wells, an always-open
 *  receipt whose signature row is the refund guarantee, inline success. */
export function MintPanel({
  asset,
  xcpUsd = null,
}: {
  asset: string;
  xcpUsd?: number | null;
}) {
  const num = useNumbers();
  const t = useT();
  const usdFmt = useFiat();
  const { address, status: walletStatus } = useWallet();
  const compose = useCompose();
  const submittedMint = useRef<{
    pending: Omit<Parameters<typeof registerPending>[0], "txid">;
    usd: number | null;
  } | null>(null);
  const [tokens, setTokens] = useState("10000");

  // The conforming fairminter for this ticker, read once and shared by both
  // ceilings below. They used to fetch it independently on the same cadence,
  // which was two identical Counterparty reads every twenty seconds per tab
  // for one answer.
  const { data: fairminter } = useSWR(
    ["mint-fairminter", asset],
    async () => (await fetchFairmintersByAsset(asset)).find((f) => xcp69Params(f)) ?? null,
    { refreshInterval: 20_000, revalidateOnFocus: false },
  );
  // How many lots are actually left to mint — core rejects a fairmint whose
  // quantity would push the asset past hard_cap outright (no partial fill
  // for priced fairminters), so a stale or missing read just means no extra
  // clamp is applied rather than a false one.
  const remainingRaw = fairminter
    ? big(saleTarget(fairminter)) - big(fairminter.earned_quantity ?? 0)
    : 0n;
  const remainingLots =
    fairminter === undefined
      ? undefined
      : fairminter === null
        ? null
        : Math.floor(approx(remainingRaw > 0n ? remainingRaw : 0n) / XCP69.QUANTITY_BY_PRICE);
  // What this address has already committed to THIS launch, confirmed and
  // pending, which is what the per-address cap is measured against.
  //
  // Both halves are needed and the pending half is the one that bites. Core
  // validates a fairmint against the ledger, and the mempool is not the
  // ledger — so a second mint from an address that already has one in flight
  // reports `status: valid` right up until it confirms, and is then recorded
  // invalid. No XCP moves on that path, but the Bitcoin fee is spent and the
  // failure shows up minutes later with nothing attached to explain it.
  const { data: alreadyMintedRaw } = useSWR(
    // Keyed by the fairminter's hash, so the allowance is measured against
    // the same launch the panel is quoting, and so the read waits for it.
    address && fairminter ? ["mint-committed", asset, address, fairminter.tx_hash] : null,
    async ([, ticker, addr, fairminterHash]) => {
      const [confirmed, mempool] = await Promise.all([
        fetchAddressFairmints(addr, ticker, fairminterHash),
        fetchMempoolSnapshot(),
      ]);
      // Unconfirmed mints carry no fairminter hash, but they do not need one:
      // only an open fairminter accepts mints, and only one can be open for a
      // ticker at a time, so a pending mint of this asset is a mint of this
      // launch.
      const pending = (mempool?.mints ?? [])
        .filter((m) => m.source === addr && m.asset === ticker)
        .reduce((sum, m) => sum + big(m.earnQuantity), 0n);
      return (confirmed + pending).toString();
    },
    { refreshInterval: 20_000, revalidateOnFocus: true },
  );

  // Three ceilings, and the smallest wins: the standard's per-transaction cap,
  // what is left of the sale, and what this address may still take.
  //
  // Undefined (not loaded, or the read failed) and null (no launch found) both
  // mean "do not clamp". Failing open is deliberate: the protocol enforces the
  // cap either way, so a wrong guess here can only cost a fee — while a wrong
  // guess the other way silently refuses a mint someone is entitled to.
  const addressLots =
    alreadyMintedRaw !== undefined && alreadyMintedRaw !== null
      ? remainingLotsForAddress(big(alreadyMintedRaw))
      : MAX_LOTS;
  const maxLots = Math.min(
    MAX_LOTS,
    remainingLots !== undefined && remainingLots !== null ? remainingLots : MAX_LOTS,
    addressLots,
  );
  /** True once this address has taken its full allowance for the launch.
   *  Requires a real answer -- an unread or failed allowance must not be
   *  reported to the user as a limit they have hit. */
  const addressCapped =
    alreadyMintedRaw !== undefined && alreadyMintedRaw !== null && addressLots === 0;

  const tokenDraft = parseBoundedSetting(tokens, maxLots * TOKENS_PER_LOT, 0, 0);
  const typedTokens = tokenDraft.value ?? 0;
  const lots = Math.max(0, Math.min(maxLots, Math.floor(typedTokens / TOKENS_PER_LOT)));
  const mintTokens = lots * TOKENS_PER_LOT;
  const adjusted = typedTokens > 0 && mintTokens !== typedTokens;
  const costXcp = lots * XCP_PER_LOT;
  const costRaw = lots * XCP69.PRICE;

  const { balance: xcpBalance, balanceError, balanceUnavailable } = useSpendableBalance(
    address,
    "XCP",
    "mint",
  );
  const insufficient =
    xcpBalance !== undefined && costRaw > 0 && costRaw > approx(xcpBalance);

  const { data: medianFeeRate } = useSWR("btc-feerate", fetchFeeRate, {
    refreshInterval: 30_000,
  });
  const { data: btcUsd } = useSWR(
    "btc-usd",
    fetchBtcUsd,
    { refreshInterval: 60_000 },
  );

  const busy = isBusy(compose.status);

  useEffect(() => {
    if (compose.status === "error") submittedMint.current = null;
    if (compose.status === "confirmed" && submittedMint.current) {
      const submitted = submittedMint.current;
      submittedMint.current = null;
      registerPending({ ...submitted.pending, txid: compose.txid });
      trackTx(compose.txid, "mint", submitted.usd);
    }
  }, [compose.status, compose.txid]);

  // A balance that could not be read does not block the mint — see
  // useSpendableBalance's balanceUnavailable. Only a read still in flight
  // holds the button, and only briefly.
  const balanceSettled = xcpBalance !== undefined || balanceUnavailable;
  const ready = tokenDraft.valid && !tokenDraft.empty && !adjusted && balanceSettled && lots > 0 && !busy && !insufficient;
  const buttonLabel = busy
    ? compose.status === "composing"
      ? t("Composing…")
      : compose.status === "signing"
        ? t("Confirm in wallet…")
        : t("Broadcasting…")
    : addressCapped
      ? t("Address limit reached")
      : lots === 0
      ? t("Enter an amount")
      : !balanceSettled
        ? t("Checking balance…")
      : insufficient
        ? t("Insufficient XCP balance")
        : t("Mint {amount} {asset}", { amount: num.commas(mintTokens), asset });

  return (
    <div className="rounded-3xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-2">
      {/* You receive — tokens, in whole lots */}
      <Well
        focusable
        label={t("You mint")}
        topRight={
          <span className="flex items-center gap-1">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setTokens(String(p))}
                className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium transition-colors active:scale-95 ${
                  mintTokens === p && typedTokens > 0
                    ? "border-purple-400 dark:border-purple-500 bg-white dark:bg-gray-900 text-purple-600 dark:text-purple-400"
                    : "border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400 hover:border-purple-400 dark:hover:border-purple-500 hover:text-purple-600 dark:hover:text-purple-400"
                }`}
              >
                {p === 1_000_000 ? t("Max") : `${p / 1000}k`}
              </button>
            ))}
          </span>
        }
        chip={<AssetChip asset={asset} />}
        footer={
          <>
            <span>
              ≈ {usdFmt(xcpUsd && costXcp > 0 ? costXcp * xcpUsd : 0)}
              {adjusted && lots > 0 && (
                <span className="text-amber-600 dark:text-amber-400">
                  {" "}
                  · {t("adjusts to {n}", { n: num.commas(mintTokens) })}
                </span>
              )}
              {/* Said plainly, because the alternative is a transaction that
                  looks fine, costs a Bitcoin fee, and is rejected minutes
                  later with nothing to explain why. Counts pending mints, so
                  it reads the same before and after a mint confirms. */}
              {addressCapped && (
                <span className="text-amber-600 dark:text-amber-400"> · {t("you have minted this launch’s max")}</span>
              )}
            </span>
            <span>
              {num.percent(mintTokens / SUPPLY_TOKENS, { digits: 3 })} {t("of supply")}
            </span>
          </>
        }
      >
        <AmountInput
          decimals={0}
          max={maxLots * TOKENS_PER_LOT}
          value={tokens}
          onChange={setTokens}
          error={adjusted ? t("Enter a multiple of {n}.", { n: num.commas(TOKENS_PER_LOT) }) : undefined}
          placeholder="0"
          ariaLabel={t("{asset} to mint", { asset })}
          className="w-full min-w-0 bg-transparent text-[2rem] font-semibold leading-tight text-gray-900 dark:text-gray-100 outline-none placeholder:text-gray-300 dark:placeholder:text-gray-600"
        />
      </Well>

      {/* You pay — XCP, escrowed by consensus */}
      <div className="mt-1">
        <Well
          label={t("You pay")}
          topRight={<span>{t("escrowed until launch")}</span>}
          chip={<AssetChip asset="XCP" />}
          footer={
            <>
              <span>≈ {usdFmt(xcpUsd && costXcp > 0 ? costXcp * xcpUsd : 0)}</span>
              {xcpBalance !== undefined && (
                <button
                  type="button"
                  className={`min-w-0 truncate hover:text-purple-600 dark:hover:text-purple-400 ${
                    insufficient ? "text-red-600 dark:text-red-400" : "text-gray-500 dark:text-gray-400"
                  }`}
                  onClick={() =>
                    setTokens(
                      String(
                        Math.min(
                          maxLots,
                          Math.floor(approx(xcpBalance) / XCP69.PRICE),
                        ) * TOKENS_PER_LOT,
                      ),
                    )
                  }
                >
                  {t("Balance:")} {num.commasRaw(xcpBalance)}
                </button>
              )}
              {xcpBalance === undefined && <BalanceUnavailable error={balanceError} />}
            </>
          }
        >
          <div
            className={`w-full min-w-0 truncate text-[2rem] font-semibold leading-tight ${
              costXcp > 0
                ? insufficient
                  ? "text-red-600 dark:text-red-400"
                  : "text-gray-900 dark:text-gray-100"
                : "text-gray-300 dark:text-gray-600"
            }`}
          >
            {costXcp > 0 ? costXcp.toFixed(2) : "0"}
          </div>
        </Well>
      </div>

      {/* Receipt — the refund guarantee is the signature row */}
      {lots > 0 && (
        <div className="px-2 pt-2">
          <dl className="space-y-1.5 border-t border-gray-100 dark:border-gray-800 pt-2 text-xs text-gray-500 dark:text-gray-400">
            <div className="flex justify-between">
              <dt>{t("If it fails to launch")}</dt>
              <dd className="font-medium text-gray-700 dark:text-gray-300">
                {t("full XCP refund, automatic")}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt>{t("Lots")}</dt>
              <dd>
                {num.commas(lots)} × {t("{n} tokens", { n: num.commas(TOKENS_PER_LOT) })}
              </dd>
            </div>
            {medianFeeRate !== undefined && (
              <div className="flex justify-between">
                <dt>{t("TX fee")}</dt>
                <dd>
                  {num.satsPerVb(medianFeeRate)} sat/vB
                  {btcUsd != null && (
                    <span className="text-gray-500 dark:text-gray-400">
                      {" "}
                      (~{usdFmt(((medianFeeRate * MINT_VBYTES) / SATS) * btcUsd)})
                    </span>
                  )}
                </dd>
              </div>
            )}
          </dl>
        </div>
      )}

      <div className="px-0.5 pb-0.5 pt-3">
        {compose.status === "error" && (
          <ErrorBanner className="mb-2" onDismiss={compose.reset}><ComposeError {...compose} /></ErrorBanner>
        )}
        {walletStatus !== "connected" ? (
          <ConnectButton />
        ) : (
          <CTA
            disabled={!ready}
            onClick={() => {
              if (!ready || submittedMint.current) return;
              submittedMint.current = {
                pending: {
                  kind: "mint",
                  label: t("Mint {amount} {asset}", { amount: num.commas(mintTokens), asset }),
                  address: address ?? undefined,
                  spends: [{ asset: "XCP", raw: costRaw.toString() }],
                },
                usd: xcpUsd ? costXcp * xcpUsd : null,
              };
              compose.composeFairmint({
                asset,
                quantity: lots * XCP69.QUANTITY_BY_PRICE,
              });
            }}
          >
            {buttonLabel}
          </CTA>
        )}
        {insufficient && (
          <p className="mt-2 text-center text-[11px] text-gray-500 dark:text-gray-400">
            {t("Need XCP?")}{" "}
            <LazyLink href="/dispense" className="text-purple-600 dark:text-purple-400 underline">
              {t("Buy some with BTC")}
            </LazyLink>
            .
          </p>
        )}
        {compose.status === "confirmed" && (
          <div className="mt-2 rounded-2xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/40 p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-green-800 dark:text-green-300">
                {t("Mint broadcast")} — <TxLink txid={compose.txid} />
              </span>
              <button
                type="button"
                onClick={compose.reset}
                className="text-xs text-green-800 dark:text-green-300 underline"
              >
                {t("Dismiss")}
              </button>
            </div>
            <p className="mt-1 text-xs text-green-700 dark:text-green-400">
              {t("Escrowed until the launch resolves: tokens if it sells out, full XCP refund if it doesn't.")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
