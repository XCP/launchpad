"use client";

import { CTA } from "@/components/ui/button";
import { useWallet } from "@/lib/wallet/wallet-context";

/**
 * The disconnected-state CTA. Never disabled — when the wallet isn't
 * connected, this IS the button.
 */
export function ConnectButton({
  size = "lg",
  className = "",
}: {
  size?: "lg" | "md";
  className?: string;
}) {
  const { status, connect } = useWallet();
  return (
    <CTA variant="dark" size={size} className={className} onClick={() => connect()}>
      {status === "not_detected" ? "Install XCP Wallet" : "Connect Wallet"}
    </CTA>
  );
}
