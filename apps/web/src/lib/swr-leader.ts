"use client";

import { useEffect, useRef, useState } from "react";
import { unstable_serialize, type Middleware, type SWRHook } from "swr";

/**
 * One tab polls, the rest listen.
 *
 * Every open tab of this site is an independent set of SWR pollers, and the
 * Counterparty node rate-limits by IP — so a person with ten tabs open is ten
 * visitors to the limiter and one to us. This middleware makes N tabs cost
 * what one tab costs, without touching a single call site: any `useSWR` with
 * a `refreshInterval` takes part automatically.
 *
 * How, in three parts:
 *
 *  1. ELECTION. Each polled key gets a Web Lock named after it. The tab that
 *     holds the lock is that key's leader and keeps its refreshInterval; every
 *     other tab with the same key mounted has its interval set to zero. Locks
 *     are per key, not per tab, so two tabs on different pages each lead their
 *     own keys and a tab on the same page follows. When the leader closes or
 *     navigates away, the browser hands the lock to the next tab in line —
 *     failover with no heartbeat, no timestamps, nothing to expire.
 *
 *  2. VISIBILITY. Only a visible tab asks for a lock, and a leader that is
 *     hidden gives its lock up. SWR already pauses intervals in hidden tabs,
 *     so a hidden leader would mean nobody polling while a visible follower
 *     waits; this keeps the polling tab the one being looked at. When every
 *     tab is hidden nobody polls, exactly as before.
 *
 *  3. DELIVERY. The leader posts each successful fetch on a BroadcastChannel,
 *     and followers write it straight into their SWR cache for that key. A
 *     follower still fetches once on mount — it has nothing to show until
 *     then — but after that it never asks the network for a polled key again
 *     while someone else leads.
 *
 * Without Web Locks or BroadcastChannel (Safari before 15.4), every tab is its
 * own leader, which is precisely the behaviour this replaces.
 *
 * PORTING NOTE — this file is copied between the XCP web repos alongside
 * lib/counterparty-relay. It needs only `use: [leaderPolling]` on the SWRConfig.
 */

const LOCK_PREFIX = "xcp:swr:";
const CHANNEL = "xcp:swr";

interface Broadcast {
  key: string;
  data: unknown;
}

const supported =
  typeof navigator !== "undefined" &&
  "locks" in navigator &&
  typeof BroadcastChannel !== "undefined";

let channel: BroadcastChannel | null = null;
const listeners = new Map<string, Set<(data: unknown) => void>>();

function getChannel(): BroadcastChannel | null {
  if (!supported) return null;
  if (channel) return channel;
  channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (event: MessageEvent<Broadcast>) => {
    const message = event.data;
    if (!message || typeof message.key !== "string") return;
    listeners.get(message.key)?.forEach((listener) => listener(message.data));
  };
  return channel;
}

function publish(key: string, data: unknown): void {
  try {
    getChannel()?.postMessage({ key, data } satisfies Broadcast);
  } catch {
    // Not structured-cloneable (a function in the data, say). Followers keep
    // what they fetched on mount; nothing else changes.
  }
}

function subscribe(key: string, listener: (data: unknown) => void): () => void {
  if (!getChannel()) return () => {};
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) listeners.delete(key);
  };
}

/**
 * Whether THIS tab currently leads `name`. Null means "not a polled key", and
 * answers false. Without Web Locks, every tab leads.
 *
 * Derived, not mirrored: the only state is which lock this tab holds, and it
 * is written only when the browser grants or takes back a lock — never
 * synchronously inside the effect.
 */
function useLeader(name: string | null): boolean {
  const [held, setHeld] = useState<string | null>(null);

  useEffect(() => {
    if (name === null || !supported) return;

    let active = true;
    let pending: AbortController | null = null;
    let release: (() => void) | null = null;

    const acquire = () => {
      if (!active || pending || release || document.visibilityState !== "visible") return;
      const controller = new AbortController();
      pending = controller;
      navigator.locks
        .request(name, { signal: controller.signal }, async () => {
          pending = null;
          // Granted, but the reason for asking may have passed while queued.
          if (!active || document.visibilityState !== "visible") return;
          setHeld(name);
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        })
        .catch(() => {
          // Aborted while queued: we stopped wanting it, nothing to do.
        })
        .finally(() => {
          if (pending === controller) pending = null;
          setHeld((current) => (current === name ? null : current));
        });
    };

    const drop = () => {
      pending?.abort();
      pending = null;
      release?.();
      release = null;
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") acquire();
      else drop();
    };

    acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVisibility);
      drop();
    };
  }, [name]);

  if (name === null) return false;
  if (!supported) return true;
  return held === name;
}

/**
 * The SWR middleware. Add to SWRConfig as `use: [leaderPolling]`; every hook
 * with a refreshInterval then elects a leader per key, and only that leader's
 * interval runs.
 */
export const leaderPolling: Middleware = (useSWRNext: SWRHook) => (key, fetcher, config) => {
  const serialized = unstable_serialize(key);
  const interval = config.refreshInterval;
  const polled =
    serialized !== "" && (typeof interval === "function" || (typeof interval === "number" && interval > 0));
  const leader = useLeader(polled ? `${LOCK_PREFIX}${serialized}` : null);

  // Read at success time, not captured at render: a fetch that started as
  // leader may land after the lock changed hands.
  const leaderRef = useRef(leader);
  leaderRef.current = leader;

  const swr = useSWRNext(key, fetcher, {
    ...config,
    refreshInterval: polled && leader ? interval : 0,
    onSuccess: (data, successKey, successConfig) => {
      if (polled && leaderRef.current) publish(serialized, data);
      config.onSuccess?.(data, successKey, successConfig);
    },
  });

  const mutateRef = useRef(swr.mutate);
  mutateRef.current = swr.mutate;

  useEffect(() => {
    if (!polled || leader) return;
    return subscribe(serialized, (data) => {
      // Straight into the cache, no revalidation: the leader just fetched it.
      void mutateRef.current(data as never, { revalidate: false });
    });
  }, [serialized, polled, leader]);

  return swr;
};
