"use client";

import Image from "next/image";
import { type ReactNode, useState } from "react";
import { useWalletChooser } from "@xcp/wallet-sdk/react";
import { CTA } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useCoarsePointer } from "@/hooks/use-coarse-pointer";
import { useWallet } from "@/lib/wallet/wallet-context";
import { useT } from "@/lib/i18n/client";

const PHONE_WIDTH = "(max-width: 639px)";

/**
 * The connect click and the panel behind it, shared by every trigger: the
 * full-width form CTA and the header's compact button want different shapes
 * but the same behavior. One installed wallet connects outright; none opens
 * the store links, or on a phone the desktop-only note; more than one opens
 * the chooser once and the choice is remembered.
 */
export function useConnectAction(): {
  status: ReturnType<typeof useWallet>["status"];
  onClick: () => void;
  installPrompt: ReactNode;
} {
  const t = useT();
  const { status } = useWallet();
  const chooser = useWalletChooser();
  const [desktopOnlyOpen, setDesktopOnlyOpen] = useState(false);
  // A coarse pointer alone does not mean "phone": iPads, touch laptops and
  // desktop-class tablet setups all report one. Only intercept the genuinely
  // phone-sized case; larger screens get the ordinary install links and let
  // their browser/store make the capability decision itself.
  const coarse = useCoarsePointer();
  const installing = chooser.action === "install";
  return {
    status,
    onClick: () =>
      installing && coarse && window.matchMedia(PHONE_WIDTH).matches
        ? setDesktopOnlyOpen(true)
        : void chooser.connect(),
    installPrompt: (
      <>
        <Dialog
          open={desktopOnlyOpen}
          onOpenChange={setDesktopOnlyOpen}
          title={t("Desktop only, for now")}
        >
          <div className="px-2 pb-2">
            <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">
              {t(
                "Connecting needs a wallet browser extension, and no mobile browser can run one yet. Everything here is readable on a phone — launches, prices, holders — but minting and trading need a desktop.",
              )}
            </p>
          </div>
        </Dialog>
        <Dialog
          open={chooser.open}
          onOpenChange={(open) => {
            if (!open) chooser.close();
          }}
          title={installing ? t("Install a wallet") : t("Choose a wallet")}
        >
          <div className="px-2 pb-2">
            <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
              {installing
                ? t("xcp.fun talks to Counterparty through a wallet browser extension. Install one, then come back and connect.")
                : t("More than one wallet is installed. Pick the one to connect with.")}
            </p>
            <ul className="space-y-2">
              {chooser.candidates.map((wallet, index) => (
                <li
                  key={wallet.id}
                  className="flex items-center gap-3 rounded-2xl border border-gray-200 px-3 py-2 dark:border-gray-800"
                >
                  {wallet.icon ? (
                    <Image src={wallet.icon} alt="" width={28} height={28} className="h-7 w-7 rounded-lg" unoptimized />
                  ) : (
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gray-100 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                      {wallet.name.charAt(0)}
                    </span>
                  )}
                  <span className="flex-1 text-sm text-gray-900 dark:text-gray-100">
                    {wallet.name}
                    {index === 0 && (
                      <span className="ml-2 text-[10px] uppercase tracking-wide text-purple-600 dark:text-purple-400">
                        {t("Recommended")}
                      </span>
                    )}
                  </span>
                  {wallet.installed ? (
                    <button
                      type="button"
                      onClick={() => void chooser.choose(wallet.id)}
                      className="rounded-xl bg-purple-600 px-3 py-1.5 text-xs font-medium text-white transition-all hover:bg-purple-500"
                    >
                      {t("Connect")}
                    </button>
                  ) : (
                    <a
                      href={wallet.installUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-xl border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition-all hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                    >
                      {t("Install ↗")}
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </Dialog>
      </>
    ),
  };
}

/** The disconnected-state CTA. Never disabled — when the wallet isn't
 *  connected, this IS the button. */
export function ConnectButton({
  size = "lg",
  className = "",
}: {
  size?: "lg" | "md";
  className?: string;
}) {
  const t = useT();
  const { status, onClick, installPrompt } = useConnectAction();
  return (
    <>
      <CTA variant="primary" size={size} className={className} onClick={onClick}>
        {status === "not_detected" ? t("Install XCP Wallet") : t("Connect Wallet")}
      </CTA>
      {installPrompt}
    </>
  );
}
