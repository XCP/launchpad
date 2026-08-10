"use client";

import { useEffect, useRef, useState } from "react";

const WS_BASE = "wss://launchpad-api.me-bbe.workers.dev";
const MAX_BACKOFF_MS = 30_000;

/**
 * How many tabs have xcp.fun open right now, anywhere on the site — one
 * WebSocket to a single fixed Durable Object (see apps/api's SitePresence),
 * not per-launch: expected traffic is low enough that a per-page count would
 * mostly read 0 or 1, which says nothing. Renders nothing until the first
 * count arrives, and nothing again if the socket never manages to connect —
 * this is ambience, not a feature anything else depends on.
 */
export function SitePresenceBadge() {
  const [count, setCount] = useState<number | null>(null);
  const attemptRef = useRef(0);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let stopped = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (stopped) return;
      const ws = new WebSocket(`${WS_BASE}/ws/presence`);
      socket = ws;
      ws.onopen = () => {
        attemptRef.current = 0;
      };
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string);
          if (msg.type === "count") setCount(msg.count);
        } catch {
          // ignore malformed frames
        }
      };
      ws.onclose = () => {
        setCount(null);
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
  }, []);

  // Reserve the pill's footprint from the first paint, even before a count
  // exists — appearing from nothing shifts everything after it (the Swap /
  // Limit / Dispense links) sideways the moment the socket answers.
  // `invisible` keeps the box in flow; only its content fades in.
  return (
    <span
      aria-hidden={count === null}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] font-medium text-gray-500 ${
        count === null ? "invisible" : ""
      }`}
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-green-500" />
      {count ?? 0} online
    </span>
  );
}
