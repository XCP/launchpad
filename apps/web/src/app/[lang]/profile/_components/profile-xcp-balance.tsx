"use client";

import useSWR from "swr";
import { useSpendableBalance } from "@xcp/wallet-sdk/react/use-spendable-balance";
import { useOpenMints } from "@/app/[lang]/profile/_lib/use-open-mints";
import { committedXcp } from "@/lib/profile-xcp";
import { useT } from "@/lib/i18n/client";
import { useNumbers } from "@/lib/i18n/numbers";
import "@/lib/wallet/sdk-config";

interface Props {
  address: string;
  onOpenMints: () => void;
}

export function ProfileXcpBalance(props: Props) {
  // Global SWR retains previous data for charts. A different address must
  // never inherit another person's balance, even for one loading frame.
  return <AddressXcpBalance key={props.address} {...props} />;
}

function AddressXcpBalance({ address, onOpenMints }: Props) {
  const t = useT();
  const num = useNumbers();
  const { balance, balanceError, pendingError, pendingOutgoing } =
    useSpendableBalance(address, "XCP", "profile");
  // Observe the SDK's existing request, with no fetcher or polling of our
  // own. Its balance can arrive before its pending-debit read; until both
  // settle we cannot honestly call the confirmed total available to spend.
  const { data: pendingDebits } = useSWR(
    [address, "counterparty-pending-debits"],
    null,
    { keepPreviousData: false },
  );
  const { data: mints, error: mintsError } = useOpenMints(address);
  const committed = committedXcp(mints);
  const unavailable = Boolean(balanceError || pendingError);
  const ready = balance !== undefined && pendingDebits !== undefined && !unavailable;

  return (
    <dl className="mt-5 grid grid-cols-1 gap-4 border-t border-gray-100 pt-4 min-[400px]:grid-cols-2 dark:border-gray-800">
      <div className="min-w-0">
        <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">
          {t("Available XCP")}
        </dt>
        <dd className="mt-1 break-words text-2xl font-semibold tabular-nums tracking-tight text-gray-900 dark:text-gray-100">
          {unavailable ? (
            <span className="text-sm font-normal text-amber-600 dark:text-amber-400">{t("Balance unavailable")}</span>
          ) : ready ? num.commasRaw(balance) : (
            <span className="text-sm font-normal text-gray-400">{t("Loading…")}</span>
          )}
        </dd>
        {ready && pendingOutgoing > 0n && (
          <dd className="mt-1 text-xs text-gray-500 dark:text-gray-400" title={t("Already deducted from available XCP")}>
            {t("{amount} XCP pending outgoing", { amount: num.commasRaw(pendingOutgoing) })}
          </dd>
        )}
      </div>
      <div className="min-w-0">
        <dt className="text-xs font-medium text-gray-500 dark:text-gray-400">
          <button type="button" onClick={onOpenMints} className="underline decoration-dotted underline-offset-4 hover:text-purple-600 dark:hover:text-purple-400">
            {t("XCP committed")}
          </button>
        </dt>
        <dd className="mt-1 break-words text-2xl font-semibold tabular-nums tracking-tight text-gray-900 dark:text-gray-100">
          {mints === undefined && !mintsError ? (
            <span className="text-sm font-normal text-gray-400">{t("Loading…")}</span>
          ) : committed === null || mintsError ? (
            <span className="text-sm font-normal text-amber-600 dark:text-amber-400">{t("Balance unavailable")}</span>
          ) : num.commasRaw(committed)}
        </dd>
        <dd className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          {t("Escrowed in open mints")}
        </dd>
      </div>
    </dl>
  );
}
