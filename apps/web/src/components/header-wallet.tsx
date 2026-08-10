"use client";

import { useState } from "react";
import { Popover as P } from "radix-ui";
import { useConnectAction } from "@/components/connect-button";
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
  const { status, address, disconnect } = useWallet();
  const [copied, setCopied] = useState(false);
  const { onClick, installPrompt } = useConnectAction();

  const connected = status === "connected" && !!address;

  // A fixed-width slot, right-aligned within it: the compact "Connect"
  // button and the wider address pill render at different widths, and
  // this sits inside a `justify-between` row, so without a reserved
  // footprint the whole FAQ/Docs/Launch block visibly slides sideways
  // the moment the wallet's connected state resolves.
  return (
    <div className="flex min-w-[9.5rem] shrink-0 justify-end">
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
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-green-500" />
            {shortAddress(address)}
          </P.Trigger>
          <P.Portal>
            <P.Content
              align="end"
              sideOffset={8}
              className="modal-pop z-50 w-56 rounded-2xl border border-gray-200 bg-white p-2 shadow-lg focus:outline-none"
            >
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
