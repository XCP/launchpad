"use client";

import { useEffect, useRef, useState } from "react";
import { Hint } from "@/components/ui/tooltip";

const WS_BASE = "wss://launchpad-api.me-bbe.workers.dev";
const MAX_BACKOFF_MS = 30_000;
const VISITOR_KEY = "xcpfun:visitor:v1";

/**
 * Hide the badge below this many people.
 *
 * "2 online" reads as an empty room and works against the thing the badge is
 * for. Zero means always show; raise it to 5 or 10 to only surface the number
 * once it flatters. Deliberately a constant and not a setting — this is a
 * judgement about the number, not a preference.
 */
const MIN_TO_SHOW = 0;

/**
 * An opaque id that is stable across this browser's tabs, so three tabs count
 * as one person rather than three.
 *
 * It is a random value with nothing derived from the visitor in it, it is sent
 * only to the presence room, and the server holds it only for as long as the
 * socket is open — it is a deduplication key, not a profile. Falls back to a
 * per-tab value when storage is unavailable (private mode, storage disabled),
 * which degrades to the old tab-counting behaviour rather than failing.
 */
function visitorId(): string {
  try {
    const existing = localStorage.getItem(VISITOR_KEY);
    if (existing) return existing;
    const fresh = crypto.randomUUID();
    localStorage.setItem(VISITOR_KEY, fresh);
    return fresh;
  } catch {
    return crypto.randomUUID();
  }
}

/**
 * How many people have xcp.fun open right now, anywhere on the site — one
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
    const id = visitorId();

    const connect = () => {
      if (stopped) return;
      const ws = new WebSocket(`${WS_BASE}/ws/presence`);
      socket = ws;
      ws.onopen = () => {
        attemptRef.current = 0;
        // Identify immediately: until this lands the room counts this socket
        // as its own anonymous visitor. Sent on every reconnect too, since a
        // reconnect is a new socket with no memory of the old one.
        ws.send(JSON.stringify({ type: "hello", id }));
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

  // A fixed overlay now, not a nav item — so there is no layout to reserve
  // and nothing shifts when the socket answers. It simply isn't there until
  // there is a number worth showing.
  if (count === null || count < MIN_TO_SHOW) return null;

  return (
    <div className="fixed bottom-4 left-4 z-40">
      <Hint
        content={
          <>
            People with xcp.fun open right now, including you. Several tabs
            from the same browser count once. Closing the tab removes you.
          </>
        }
      >
        <span
          tabIndex={0}
          className="modal-pop inline-flex cursor-default items-center gap-1.5 rounded-full border border-gray-200 dark:border-gray-800 bg-white/95 dark:bg-gray-900/95 px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 shadow-lg backdrop-blur focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500"
        >
          <span aria-hidden className="size-2 rounded-full bg-green-500" />
          {count} online
        </span>
      </Hint>
    </div>
  );
}
