"use client";

import { type ReactNode, useState } from "react";
import { CTA } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useCoarsePointer } from "@/hooks/use-coarse-pointer";
import { useWallet } from "@/lib/wallet/wallet-context";

const CHROME_STORE_URL =
  "https://chromewebstore.google.com/detail/xcp-wallet/nicpjdbehgcjbjfjkobcidnfmfpijohg";

/**
 * The connect click and its install-prompt modal, shared by every trigger
 * that needs one — the full-width form CTA and the header's compact
 * button want different shapes but the same behavior: "not_detected"
 * opens an install prompt instead of calling connect(), which has no
 * provider to talk to yet.
 */
export function useConnectAction(): { status: ReturnType<typeof useWallet>["status"]; onClick: () => void; installPrompt: ReactNode } {
  const { status, connect } = useWallet();
  const [installOpen, setInstallOpen] = useState(false);
  const [desktopOnlyOpen, setDesktopOnlyOpen] = useState(false);
  // The wallet is a browser extension, so "not detected" on a phone is not a
  // missing install — it is a thing that cannot be installed there. Sending
  // someone to the Chrome Web Store from a phone is a dead end, so that case
  // gets an explanation instead of a link.
  const coarse = useCoarsePointer();
  const cannotInstall = status === "not_detected" && coarse;
  return {
    status,
    onClick: () =>
      cannotInstall
        ? setDesktopOnlyOpen(true)
        : status === "not_detected"
          ? setInstallOpen(true)
          : connect(),
    installPrompt: (
      <>
      <Dialog
        open={desktopOnlyOpen}
        onOpenChange={setDesktopOnlyOpen}
        title="Desktop only, for now"
      >
        <div className="px-2 pb-2">
          <p className="text-sm leading-relaxed text-gray-600">
            Connecting needs the XCP Wallet browser extension, and no mobile
            browser can run it yet. Everything here is readable on a phone —
            launches, prices, holders — but minting and trading need a desktop.
          </p>
        </div>
      </Dialog>
      <Dialog
        open={installOpen}
        onOpenChange={setInstallOpen}
        title="Install the XCP Wallet"
      >
        <div className="px-2 pb-2">
          <p className="mb-4 text-sm text-gray-600">
            xcp.fun talks to Counterparty through the XCP Wallet browser
            extension. Install it, then come back and connect.
          </p>
          <a
            href={CHROME_STORE_URL}
            target="_blank"
            rel="noreferrer"
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-purple-600 px-5 py-3.5 font-medium text-white transition-all hover:bg-purple-500 active:scale-[0.99]"
          >
            Get it from the Chrome Web Store ↗
          </a>
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
  const { status, onClick, installPrompt } = useConnectAction();
  return (
    <>
      <CTA variant="primary" size={size} className={className} onClick={onClick}>
        {status === "not_detected" ? "Install XCP Wallet" : "Connect Wallet"}
      </CTA>
      {installPrompt}
    </>
  );
}
