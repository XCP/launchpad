"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

export interface PendingMint {
  tx_hash: string;
  source: string;
  quantity: number | string;
}

export interface RoomTrade {
  key: string;
  block: number;
  time: number;
  buy: boolean;
  token_quantity: string;
  xcp_quantity: string;
  address: string;
  venue: "pool" | "book";
  tx_hash: string;
}

export interface RoomState {
  status: string;
  earned_quantity: string | number | null;
  paid_quantity: string | number | null;
  pending_count: number;
  pending_quantity: number;
  pending: PendingMint[];
  /** Only once graduated — while minting there is no market. */
  trades?: RoomTrade[];
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
/**
 * Re-render the page when the launch leaves the state it was rendered in.
 *
 * The room already broadcasts the fairminter's live `status`, and the page was
 * server-rendered against one particular status — so the two disagreeing is
 * the precise, evidence-backed moment the page has gone stale. Until now only
 * scheduled → minting was handled (by a countdown polling router.refresh),
 * which meant the two transitions people most want to witness — selling out,
 * and refunding — left the viewer looking at a dead page until they hit
 * reload.
 *
 * Refreshing rather than patching state locally: a transition changes the
 * whole view (a mint form becomes a trade surface, a pool appears), and the
 * server already knows how to build that. Repeated because Counterparty has to
 * parse the block before its own record agrees, so the first refresh can
 * return the same page; it stops as soon as the server catches up.
 */
export function useStatusTransition(serverStatus: string) {
  const { state } = useLaunchRoom();
  const router = useRouter();
  const live = state?.status;
  useEffect(() => {
    if (!live || live === serverStatus) return;
    const id = setInterval(() => router.refresh(), 15_000);
    router.refresh();
    return () => clearInterval(id);
  }, [live, serverStatus, router]);
}

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
