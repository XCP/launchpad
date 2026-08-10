"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export interface PendingMint {
  tx_hash: string;
  source: string;
  quantity: number | string;
}

export interface RoomState {
  status: string;
  earned_quantity: string | number | null;
  paid_quantity: string | number | null;
  pending_count: number;
  pending_quantity: number;
  pending: PendingMint[];
}

interface RoomContextValue {
  connected: boolean;
  state: RoomState | null;
}

const LaunchRoomContext = createContext<RoomContextValue>({
  connected: false,
  state: null,
});

/** Everything under a LaunchRoomProvider reads live state from here instead
 *  of opening its own poll loop — the whole point of the shared room. */
export function useLaunchRoom(): RoomContextValue {
  return useContext(LaunchRoomContext);
}

const WS_BASE = "wss://launchpad-api.me-bbe.workers.dev";
const MAX_BACKOFF_MS = 30_000;

/**
 * One shared WebSocket per page, to the launch's Durable Object room —
 * replaces what used to be up to three separate per-visitor polling loops
 * (LiveProgress's own fairminter+mempool poll, the Mempool tab's own
 * mempool poll) with a single connection whose server-side counterpart is
 * itself shared across every visitor currently watching this launch.
 *
 * Reconnects with exponential backoff on drop; a socket that never manages
 * to connect just leaves every consumer at `connected: false`, and callers
 * are expected to fall back to their last server-rendered values rather
 * than block on this ever succeeding.
 */
export function LaunchRoomProvider({
  asset,
  fairminterTxHash,
  enabled,
  children,
}: {
  asset: string;
  fairminterTxHash: string;
  enabled: boolean;
  children: ReactNode;
}) {
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState<RoomState | null>(null);
  const attemptRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let socket: WebSocket | null = null;
    let stopped = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (stopped) return;
      const ws = new WebSocket(
        `${WS_BASE}/ws/launches/${encodeURIComponent(asset)}?fm=${encodeURIComponent(fairminterTxHash)}`,
      );
      socket = ws;
      ws.onopen = () => {
        attemptRef.current = 0;
        setConnected(true);
      };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string);
          if (msg.type === "state") setState(msg);
        } catch {
          // Malformed frame — ignore it, the next tick will correct itself.
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (stopped) return;
        const attempt = attemptRef.current + 1;
        attemptRef.current = attempt;
        const delay = Math.min(MAX_BACKOFF_MS, 1_000 * 2 ** attempt);
        retryTimer = setTimeout(connect, delay);
      };
      ws.onerror = () => ws.close();
    };

    connect();
    return () => {
      stopped = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
    };
  }, [asset, fairminterTxHash, enabled]);

  return (
    <LaunchRoomContext.Provider value={{ connected, state }}>
      {children}
    </LaunchRoomContext.Provider>
  );
}
