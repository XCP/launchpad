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

/** The site's vocabulary. `locked` reads as connected: the grant stands, and a signing call opens the unlock screen. */
export type XcpWalletStatus = "not_detected" | "disconnected" | "connected";

const STATUS: Record<WalletReadyState, XcpWalletStatus> = {
  detecting: "not_detected",
  not_installed: "not_detected",
  disconnected: "disconnected",
  connected: "connected",
  locked: "connected",
};

export function WalletProvider({ children }: { children: ReactNode }) {
  return <SdkWalletProvider>{children}</SdkWalletProvider>;
}

export function useWallet() {
  const wallet = useSdkWallet();
  return { ...wallet, status: STATUS[wallet.readyState] };
}
