"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { CHAT_MAX_MESSAGES, CHAT_TTL_MS, isChatAuthorId, isChatHandle, parseChatFrame, type ChatBan, type ChatMessage } from "@launchpad/chat";

const WS_URL = process.env.NEXT_PUBLIC_CHAT_WS_URL ?? "wss://api.xcp.fun/ws/chat";
const MAX_BACKOFF_MS = 30_000;
export type ChatStatus = "connecting" | "live" | "reconnecting" | "offline";

function recentMessages(messages: ChatMessage[]): ChatMessage[] {
  const cutoff = Date.now() - CHAT_TTL_MS;
  return [...new Map(messages.filter((message) => message.createdAt > cutoff).map((message) => [message.id, message])).values()]
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .slice(-CHAT_MAX_MESSAGES);
}

/** One read-only room connection, present only while its transcript is visible. */
export function useChat(active: boolean) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>("connecting");
  const [connections, setConnections] = useState<number | null>(null);
  const acceptMessage = useCallback((message: ChatMessage) => {
    setMessages((previous) => recentMessages([...previous, message]));
  }, []);

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let socket: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const retry = () => {
      if (stopped) return;
      setStatus("reconnecting");
      const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(attempt++, 5)) * (0.75 + Math.random() * 0.25);
      timer = setTimeout(connect, delay);
    };
    const connect = () => {
      if (stopped) return;
      setStatus(attempt > 0 ? "reconnecting" : "connecting");
      setConnections(null);
      let ws: WebSocket;
      try { ws = new WebSocket(WS_URL); } catch { retry(); return; }
      socket = ws;
      const current = () => !stopped && socket === ws;
      ws.onopen = () => { if (current()) setStatus("live"); };
      ws.onmessage = (event) => {
        if (!current() || typeof event.data !== "string") return;
        try {
          const frame = parseChatFrame(event.data);
          if (!frame) return;
          if (frame.count !== undefined) setConnections(frame.count);
          // Reconnection history is authoritative: expired/removed messages
          // must disappear instead of being merged back into the transcript.
          if (frame.type === "history") {
            attempt = 0;
            setMessages(recentMessages(frame.messages));
          } else if (frame.type === "message") {
            acceptMessage(frame.message);
          }
        } catch { /* Malformed public frames do not enter the transcript. */ }
      };
      ws.onclose = () => { if (current()) { socket = null; retry(); } };
      ws.onerror = () => { if (current()) ws.close(); };
    };
    connect();
    const expiry = setInterval(() => setMessages((previous) => recentMessages(previous)), 30_000);
    return () => {
      stopped = true;
      clearTimeout(timer);
      clearInterval(expiry);
      socket?.close();
    };
  }, [active, acceptMessage]);

  return { messages, status: active ? status : "offline" as ChatStatus, connections: active && status === "live" ? connections : null, acceptMessage };
}

type MutedAuthor = { authorId: string; handle: string };
const MUTED_KEY = "xcpfun:chat-muted:v1";
const EMPTY: MutedAuthor[] = [];
let muted: MutedAuthor[] | undefined;
const listeners = new Set<() => void>();
function readMuted(): MutedAuthor[] {
  if (muted) return muted;
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(MUTED_KEY) ?? "[]");
    muted = Array.isArray(saved) ? saved.filter((item): item is MutedAuthor =>
      item && typeof item.authorId === "string" && typeof item.handle === "string",
    ).slice(-100) : EMPTY;
  } catch { muted = EMPTY; }
  return muted;
}
function notify() { for (const listener of listeners) listener(); }
function storage(event: StorageEvent) {
  if (event.key === MUTED_KEY || event.key === null) { muted = undefined; notify(); }
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener("storage", storage);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) window.removeEventListener("storage", storage);
  };
}
export function useMutedChatAuthors() {
  const authors = useSyncExternalStore(subscribe, readMuted, () => EMPTY);
  const update = (next: MutedAuthor[]) => {
    muted = next;
    try { localStorage.setItem(MUTED_KEY, JSON.stringify(next)); } catch { /* Session-only mute still works. */ }
    notify();
  };
  return {
    authors,
    mute: (author: MutedAuthor) => update([...readMuted().filter((item) => item.authorId !== author.authorId), author].slice(-100)),
    unmute: (authorId: string) => update(readMuted().filter((item) => item.authorId !== authorId)),
  };
}

export interface ChatIdentity { address: string; authorId: string; handle: string; isAdmin: boolean }
export function useChatIdentity(active: boolean, address: string | null) {
  const [identity, setIdentity] = useState<ChatIdentity | null>(null);
  const [resolvedAddress, setResolvedAddress] = useState<string | null>(null);
  useEffect(() => {
    if (!active || !address || (resolvedAddress === address && identity?.address === address)) return;
    let stopped = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    void fetch("/api/chat", { method: "GET", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const value: unknown = await response.json();
        if (stopped || !value || typeof value !== "object") return;
        const candidate = value as Partial<ChatIdentity>;
        if (candidate.address === address && isChatAuthorId(candidate.authorId) && isChatHandle(candidate.handle)) {
          setIdentity({ address, authorId: candidate.authorId, handle: candidate.handle, isAdmin: candidate.isAdmin === true });
          setResolvedAddress(address);
        }
      }).catch(() => {}).finally(() => clearTimeout(timeout));
    return () => { stopped = true; clearTimeout(timeout); controller.abort(); };
  }, [active, address, resolvedAddress, identity?.address]);
  const rememberIdentity = (messageIdentity: Omit<ChatIdentity, "isAdmin">) => setIdentity((previous) => ({
    ...messageIdentity, isAdmin: previous?.address === messageIdentity.address && previous.isAdmin === true,
  }));
  return { identity: identity?.address === address ? identity : null, rememberIdentity };
}

/** Moderation is explicit and private: no background list polling. */
export function useChatModeration(identity: ChatIdentity | null) {
  const address = identity?.isAdmin ? identity.address : null;
  const [state, setState] = useState<{ address: string | null; bans: ChatBan[]; loaded: boolean; loading: boolean; pending: string | null; error: "load" | "update" | null }>({ address: null, bans: [], loaded: false, loading: false, pending: null, error: null });
  const current = useRef<string | null>(address);
  const read = useRef<AbortController | null>(null);
  const write = useRef<AbortController | null>(null);
  useEffect(() => {
    current.current = address;
    return () => { current.current = null; read.current?.abort(); read.current = null; write.current?.abort(); write.current = null; };
  }, [address]);
  const update = (expected: string, patch: Partial<typeof state>) => {
    if (current.current !== expected) return;
    setState((previous) => ({ ...(previous.address === expected ? previous : { address: expected, bans: [], loaded: false, loading: false, pending: null, error: null }), ...patch }));
  };
  const load = async () => {
    if (!address || write.current) return;
    read.current?.abort();
    const abort = new AbortController(); read.current = abort;
    const timeout = setTimeout(() => abort.abort(), 10_000);
    update(address, { loading: true, error: null });
    try {
      const response = await fetch("/api/chat/moderation", { method: "GET", cache: "no-store", signal: abort.signal });
      const value = await response.json() as { bans?: unknown };
      if (!response.ok || !Array.isArray(value.bans)) throw new Error("Invalid ban list");
      const bans = value.bans.filter((ban): ban is ChatBan => !!ban && typeof ban === "object" && isChatAuthorId(ban.authorId) && isChatHandle(ban.handle) && Number.isFinite(ban.createdAt));
      if (!abort.signal.aborted) update(address, { bans, loaded: true, loading: false });
    } catch {
      if (read.current === abort) update(address, { loading: false, error: "load" });
    } finally { clearTimeout(timeout); }
  };
  const moderate = async (author: Pick<ChatBan, "authorId" | "handle">, banned: boolean) => {
    if (!address || write.current) return;
    read.current?.abort(); read.current = null;
    const abort = new AbortController(); write.current = abort;
    const timeout = setTimeout(() => abort.abort(), 10_000);
    update(address, { pending: author.authorId, loading: false, error: null });
    try {
      const response = await fetch("/api/chat/moderation", {
        method: "POST", headers: { "content-type": "application/json" }, signal: abort.signal,
        body: JSON.stringify({ address, authorId: author.authorId, banned }),
      });
      const value = await response.json() as { ok?: boolean };
      if (!response.ok || value.ok !== true) throw new Error("Ban update failed");
      if (abort.signal.aborted || current.current !== address) return;
      setState((previous) => {
        const bans = (previous.address === address ? previous.bans : []).filter((ban) => ban.authorId !== author.authorId);
        return { address, bans: banned ? [...bans, { ...author, createdAt: Date.now() }] : bans, loaded: previous.address === address && previous.loaded, loading: false, pending: null, error: null };
      });
      return true;
    } catch {
      if (write.current !== abort || current.current !== address) return;
      update(address, { pending: null, error: "update" });
      return false;
    } finally { clearTimeout(timeout); if (write.current === abort) write.current = null; }
  };
  return { ...(state.address === address ? state : { bans: [], loaded: false, loading: false, pending: null, error: null }), load, moderate };
}

const COLLAPSED_KEY = "xcpfun:chat-collapsed:v1";
let collapsed: boolean | undefined;
const collapseListeners = new Set<() => void>();
function readCollapsed() {
  if (collapsed !== undefined) return collapsed;
  try { collapsed = localStorage.getItem(COLLAPSED_KEY) === "1"; } catch { collapsed = false; }
  return collapsed;
}
function collapseChanged() { for (const listener of collapseListeners) listener(); }
function collapseStorage(event: StorageEvent) {
  if (event.key === COLLAPSED_KEY || event.key === null) { collapsed = undefined; collapseChanged(); }
}
function subscribeCollapsed(listener: () => void) {
  collapseListeners.add(listener);
  if (collapseListeners.size === 1) window.addEventListener("storage", collapseStorage);
  return () => {
    collapseListeners.delete(listener);
    if (!collapseListeners.size) window.removeEventListener("storage", collapseStorage);
  };
}
export function useChatCollapsed() {
  const value = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
  return [value, (next: boolean) => {
    collapsed = next;
    try { localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0"); } catch { /* Session-only preference remains usable. */ }
    collapseChanged();
  }] as const;
}
