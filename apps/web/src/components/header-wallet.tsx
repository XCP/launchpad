"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Popover as P } from "radix-ui";
import { useConnectAction } from "@/components/connect-button";
import { trackTx } from "@/lib/analytics";
import { shortAddress } from "@/lib/format";
import { useWallet } from "@/lib/wallet/wallet-context";

/**
 * The header's wallet slot: same shape as the Launch button beside it
 * (just purple, saying "Connect") while disconnected, a short-address
 * pill with a small menu once connected. Same wallet state every form on
 * the site already reads — this is just its one global, always-visible
 * surface.
 */
export function HeaderWallet() {
  const { status, address, proofStatus, disconnect } = useWallet();
  const proof = {
    verified: { dot: "bg-green-500", label: "Signature verified" },
    unverified: { dot: "bg-gray-400", label: "Signature not checked this session" },
    failed: { dot: "bg-red-500", label: "Signature did not verify" },
  }[proofStatus];
  const [copied, setCopied] = useState(false);
  const { onClick, installPrompt } = useConnectAction();

  const connected = status === "connected" && !!address;

  // The top of the funnel, reported from the header because it is the one
  // wallet surface that exists on every page — tracking it at the Connect
  // button would miss connections restored on load, and would double-report
  // wherever two buttons are mounted at once. Keyed on the address so
  // switching accounts counts again but a re-render never does.
  useEffect(() => {
    if (connected && address) trackTx(address, "wallet connected");
  }, [connected, address]);

  // Sized to its content, deliberately. A reserved 9.5rem slot used to hold
  // the connected pill's width at all times, which kept FAQ and Docs floating
  // a button's width away from the wallet even for someone who has never
  // connected — a permanent gap to spare one group of users a single shift.
  //
  // The trade is small and one-sided: the disconnected and not-detected states
  // render the same button, so a new visitor never moves at all. Only a
  // returning connected visitor shifts, once, when the stored address resolves
  // — and that read is synchronous from localStorage, so it lands within a
  // frame of hydration rather than after a round trip.
  return (
    <div className="flex shrink-0 justify-end">
      {!connected ? (
        <>
          <button
            type="button"
            onClick={onClick}
            className="rounded-md bg-purple-600 px-3 py-1.5 text-white hover:bg-purple-500"
          >
            Connect
          </button>
          {installPrompt}
        </>
      ) : (
        <P.Root>
          <P.Trigger className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:border-purple-300 hover:text-purple-600 data-[state=open]:border-purple-300 data-[state=open]:text-purple-600">
            <span
              aria-hidden
              title={proof.label}
              className={`size-1.5 shrink-0 rounded-full ${proof.dot}`}
            />
            {shortAddress(address)}
          </P.Trigger>
          <P.Portal>
            <P.Content
              align="end"
              sideOffset={8}
              className="modal-pop z-50 w-56 rounded-2xl border border-gray-200 bg-white p-2 shadow-lg focus:outline-none"
            >
              <p className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400">
                <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${proof.dot}`} />
                {proof.label}
              </p>
              <Link
                href="/profile"
                className="block rounded-xl px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Your profile
              </Link>
              <div className="my-1 border-t border-gray-100" />
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(address).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }, () => {});
                }}
                className="block w-full rounded-xl px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
              >
                {copied ? "Copied" : "Copy address"}
              </button>
              <a
                href={`https://xcp.io/address/${address}`}
                target="_blank"
                rel="noreferrer"
                className="block rounded-xl px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                View on explorer ↗
              </a>
              <div className="my-1 border-t border-gray-100" />
              <button
                type="button"
                onClick={() => disconnect()}
                className="block w-full rounded-xl px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
              >
                Disconnect
              </button>
            </P.Content>
          </P.Portal>
        </P.Root>
      )}
    </div>
  );
}
