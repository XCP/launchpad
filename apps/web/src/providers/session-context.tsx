"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useWallet } from "@/lib/wallet/wallet-context";

type SessionStatus = "checking" | "authenticated" | "unauthenticated" | "unavailable";
interface VerifiedSession {
  address: string;
  expiresAt: number;
}
interface SessionValue {
  /** Verified, unexpired server identity matching the selected wallet. */
  address: string | null;
  /** Unix seconds. */
  expiresAt: number | null;
  status: SessionStatus;
  /** Recheck the cookie/current proof. Never asks the wallet to sign. */
  retry: () => void;
  /** Drop rejected authorization immediately; do not automatically retry it. */
  invalidate: () => void;
}

const SessionContext = createContext<SessionValue>({
  address: null, expiresAt: null, status: "unauthenticated", retry: () => {}, invalidate: () => {},
});

// Cookie responses mutate browser state even after an effect has been cleaned
// up. Keep one queue across provider remounts (including StrictMode), and never
// abort a superseded write then race its still-arriving Set-Cookie response.
let cookieQueue: Promise<unknown> = Promise.resolve();
function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const pending = cookieQueue.then(operation, operation);
  cookieQueue = pending.catch(() => {});
  return pending;
}

function parseSession(value: unknown): VerifiedSession | null {
  if (!value || typeof value !== "object") return null;
  const { address, expires_at: expiresAt } = value as Record<string, unknown>;
  return typeof address === "string" && address !== "" && typeof expiresAt === "number"
    && Number.isSafeInteger(expiresAt) && expiresAt > Math.floor(Date.now() / 1000)
    ? { address, expiresAt } : null;
}

interface SessionState {
  selected: string | null;
  session: VerifiedSession | null;
  status: SessionStatus;
}

/** Restore a signed cookie, or exchange an already verified connection proof.
 * Wallets without either remain unauthenticated; this provider never prompts. */
export function SessionProvider({ children }: { children: ReactNode }) {
  const { address, readyState, proofStatus, connectionProof } = useWallet();
  const [result, setResult] = useState<SessionState>({
    selected: address, session: null, status: address ? "checking" : "unauthenticated",
  });
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const blockedProof = useRef<string | null>(null);
  const proofKey = `${address ?? ""}\n${connectionProof?.message ?? ""}`;

  // Clear on every selection transition, including A → disconnected → A. A
  // previous result must not become trusted again just because A was selected.
  if (result.selected !== address) {
    setResult({ selected: address, session: null, status: address ? "checking" : "unauthenticated" });
  }

  const retry = useCallback(() => {
    blockedProof.current = null;
    setAttempt((value) => value + 1);
  }, []);

  const invalidate = useCallback(() => {
    generation.current += 1;
    blockedProof.current = proofKey;
    setResult({ selected: address, session: null, status: "unauthenticated" });
    void serialized(async () => {
      await fetch("/api/session", { method: "DELETE" });
    }).catch(() => {});
  }, [address, proofKey]);

  useEffect(() => {
    const current = ++generation.current;
    let cancelled = false;
    const active = () => !cancelled && generation.current === current;
    const disconnect = !address && readyState === "disconnected";
    const finish = (status: SessionStatus, session: VerifiedSession | null = null) => {
      if (active()) setResult({ selected: address, session, status });
    };

    void serialized(async () => {
      // Once a disconnect was observed, its cookie clear must still happen
      // even if the same wallet reconnects before an older POST completes.
      if (!active() && !disconnect) return;
      try {
        if (!address) {
          // Initial wallet detection must not erase a restorable cookie. An
          // actual disconnect does, after any earlier in-flight cookie write.
          if (disconnect) {
            await fetch("/api/session", { method: "DELETE" });
          }
          finish("unauthenticated");
          return;
        }
        if (blockedProof.current === proofKey) {
          finish("unauthenticated");
          return;
        }
        finish("checking");
        const existing = await fetch("/api/session", { cache: "no-store" });
        if (!active()) return;
        if (!existing.ok) {
          finish("unavailable");
          return;
        }
        const restored = parseSession(await existing.json());
        if (!active()) return;
        if (restored?.address === address) {
          finish("authenticated", restored);
          return;
        }
        if (restored) {
          const cleared = await fetch("/api/session", { method: "DELETE" });
          if (!active()) return;
          if (!cleared.ok) {
            finish("unavailable");
            return;
          }
        }
        if (proofStatus !== "verified" || !connectionProof || connectionProof.address !== address) {
          finish("unauthenticated");
          return;
        }
        const response = await fetch("/api/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ proof: connectionProof }),
        });
        if (!active()) return;
        if (!response.ok) {
          finish(response.status >= 500 ? "unavailable" : "unauthenticated");
          return;
        }
        const session = parseSession(await response.json());
        finish(session?.address === address ? "authenticated" : "unauthenticated",
          session?.address === address ? session : null);
      } catch {
        finish("unavailable");
      }
    });

    return () => { cancelled = true; };
  }, [address, readyState, proofStatus, connectionProof, proofKey, attempt]);

  useEffect(() => {
    const session = result.session;
    if (!session) return;
    const expire = () => {
      if (Date.now() < session.expiresAt * 1000) return;
      blockedProof.current = proofKey;
      setResult((previous) => previous.session === session
        ? { selected: previous.selected, session: null, status: "unauthenticated" } : previous);
    };
    const timer = setTimeout(expire, Math.max(0, session.expiresAt * 1000 - Date.now()));
    // Background tabs can delay timers; recheck when the visitor returns.
    window.addEventListener("focus", expire);
    document.addEventListener("visibilitychange", expire);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", expire);
      document.removeEventListener("visibilitychange", expire);
    };
  }, [result.session, proofKey]);

  const session = result.selected === address ? result.session : null;
  const status = !address ? "unauthenticated" : result.selected !== address ? "checking"
    : result.status === "authenticated" && !session ? "unauthenticated" : result.status;
  return <SessionContext value={{ address: session?.address ?? null, expiresAt: session?.expiresAt ?? null,
    status, retry, invalidate }}>{children}</SessionContext>;
}

export function useSession() {
  return useContext(SessionContext);
}
