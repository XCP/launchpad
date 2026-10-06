"use client";

import type { ReactNode } from "react";
import {
  type ProofStatus,
  type WalletReadyState,
  WalletProvider as SdkWalletProvider,
  useWallet as useSdkWallet,
} from "@xcp/wallet-sdk/react";
import "@/lib/wallet/sdk-config";

export type { ProofStatus };

/**
 * The site's vocabulary. `locked` reads as connected: the grant stands, and a signing call opens the unlock screen.
 * `reload_required` (the extension was updated and this page's bridge to it is dead) reads as disconnected, so
 * the connect button shows, and under the SDK's `reload` action it reloads the page; the address and the
 * remembered connection stay, so the session is not dropped.
 */
export type XcpWalletStatus = "not_detected" | "disconnected" | "connected";

const STATUS: Record<WalletReadyState, XcpWalletStatus> = {
  detecting: "not_detected",
  not_installed: "not_detected",
  disconnected: "disconnected",
  connected: "connected",
  locked: "connected",
  reload_required: "disconnected",
};

export function WalletProvider({ children }: { children: ReactNode }) {
  // Connect is login here: a wallet that proves nothing at connect (Horizon) is asked to sign the proof.
  return <SdkWalletProvider proofOnConnect>{children}</SdkWalletProvider>;
}

export function useWallet() {
  const wallet = useSdkWallet();
  return { ...wallet, status: STATUS[wallet.readyState] };
}
