"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useWallet } from "@/lib/wallet/wallet-context";

/**
 * Turns a verified wallet connection into a server-side session.
 *
 * Deliberately app-level rather than part of the wallet SDK: the SDK's job
 * ends at "here is a proof", and sessions are this site's policy. It runs
 * automatically because the proof it trades in is auto-signed — the user
 * never sees a prompt for any of this, which is the whole point. The one
 * signature they would otherwise be asked for on every metadata edit is what
 * this replaces.
 *
 * A failure here is not an error state: the edit path falls back to signing
 * each write, so an unset SESSION_SECRET or an offline API just costs a
 * wallet prompt later.
 */
interface SessionValue {
  /** Address the server currently accepts us as, or null. */
  address: string | null;
}

const SessionContext = createContext<SessionValue>({ address: null });

export function SessionProvider({ children }: { children: ReactNode }) {
  const { address, proofStatus, connectionProof } = useWallet();
  const [sessionAddress, setSessionAddress] = useState<string | null>(null);
  // Proof messages carry a nonce, so this both dedupes repeat effect runs and
  // lets a genuinely fresh proof for the same address replace a lapsed session.
  const exchangedRef = useRef<string | null>(null);
  const activeRef = useRef<string | null>(null);

  useEffect(() => {
    if (!address || proofStatus !== "verified" || !connectionProof) return;
    if (exchangedRef.current === connectionProof.message) return;
    exchangedRef.current = connectionProof.message;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ proof: connectionProof }),
        });
        if (cancelled) return;
        if (res.ok) {
          activeRef.current = address;
          setSessionAddress(address);
        } else {
          exchangedRef.current = null;
        }
      } catch {
        if (!cancelled) exchangedRef.current = null;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address, proofStatus, connectionProof]);

  // Disconnecting, or switching accounts, must not leave the old cookie on the
  // browser. Tracked in a ref rather than state so this doesn't have to write
  // state during an effect — what's exposed below is derived, so a stale
  // sessionAddress can't be mistaken for a live one anyway.
  useEffect(() => {
    const active = activeRef.current;
    if (!active || active === address) return;
    activeRef.current = null;
    exchangedRef.current = null;
    void fetch("/api/session", { method: "DELETE" }).catch(() => {});
  }, [address]);

  const value = sessionAddress && sessionAddress === address ? sessionAddress : null;
  return <SessionContext value={{ address: value }}>{children}</SessionContext>;
}

export function useSession() {
  return useContext(SessionContext);
}
