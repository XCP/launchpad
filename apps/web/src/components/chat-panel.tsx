"use client";

import { Dialog as D, DropdownMenu as DM } from "radix-ui";
import { useEffect, useId, useImperativeHandle, useRef, useState, type FormEvent, type Ref } from "react";
import { CHAT_COOLDOWN_MS, CHAT_MAX_CODEPOINTS, CHAT_MAX_LINES, chatLineCount, normalizeChatText, parseChatFrame, type ChatMessage } from "@launchpad/chat";
import { useMutedChatAuthors, type ChatIdentity, type ChatStatus } from "@/hooks/use-chat";
import { useChatContext, type ChatDraftMemory } from "@/providers/chat-context";
import { useT } from "@/lib/i18n/client";
import { useNumbers } from "@/lib/i18n/numbers";
import { useWallet } from "@/lib/wallet/wallet-context";
import { useSession } from "@/providers/session-context";
import { parseChatCommand, resolveChatAuthor } from "@/lib/chat-commands";
import { parseChatCashtags } from "@/lib/chat-assets";
import { useChatAssetLinks } from "@/hooks/use-chat-assets";
import { LazyLink } from "@/components/lazy-link";

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500";

/** Active launch pages mount this once; a hidden phone bubble owns no socket. */
export function ChatPanel() {
  const t = useT();
  const chat = useChatContext();
  const { desktop, expanded, open, setOpen, setCollapsed } = chat;
  const titleId = useId();
  const bubble = <button type="button" onClick={desktop ? () => setCollapsed(false) : undefined} aria-label={t("Open chat")} className={`chat-bubble fixed right-4 z-40 inline-flex min-h-10 items-center gap-2 rounded-full border border-gray-200 bg-white/95 px-3 py-2 text-xs font-semibold text-gray-700 shadow-lg backdrop-blur dark:border-gray-800 dark:bg-gray-900/95 dark:text-gray-200 ${FOCUS}`}>
    <span aria-hidden="true">💬</span>{t("Chat")}
  </button>;
  return (
    <>
      {expanded ? (
        <aside className="chat-sidebar min-w-0 self-start" aria-labelledby={titleId}>
          <ChatContent {...chat} titleId={titleId}
            close={<button type="button" aria-label={t("Collapse chat")} title={t("Collapse chat")} onClick={() => setCollapsed(true)} className={`flex size-8 items-center justify-center rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 ${FOCUS}`}>×</button>} />
        </aside>
      ) : desktop ? bubble : (
        <D.Root open={open} onOpenChange={setOpen}>
          <D.Trigger asChild>{bubble}</D.Trigger>
          <D.Portal>
            <D.Overlay className="fixed inset-0 z-50 bg-black/40" />
            <D.Content className="chat-sheet fixed inset-x-0 bottom-0 z-50 mx-auto flex max-w-lg flex-col overflow-hidden rounded-t-2xl border border-gray-200 bg-white shadow-xl outline-none dark:border-gray-800 dark:bg-gray-900">
              <D.Title className="sr-only">{t("Chat")}</D.Title>
              <D.Description className="sr-only">{t("Public chat")}</D.Description>
              <ChatContent {...chat} titleId={titleId} close={<D.Close type="button" aria-label={t("Close chat")} className={`flex size-8 items-center justify-center rounded text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 ${FOCUS}`}>×</D.Close>} />
            </D.Content>
          </D.Portal>
        </D.Root>
      )}
    </>
  );
}

function ChatContent({ messages, status, connections, acceptMessage, identity, drafts, rememberDraft, titleId, close }: {
  messages: ChatMessage[];
  status: ChatStatus;
  connections: number | null;
  acceptMessage: (message: ChatMessage) => void;
  identity: ChatIdentity | null;
  drafts: Record<string, ChatDraftMemory>;
  rememberDraft: (address: string, update: Partial<ChatDraftMemory>) => void;
  titleId: string;
  close?: React.ReactNode;
}) {
  const t = useT();
  const num = useNumbers();
  const { address } = useWallet();
  const { authors, mute, unmute } = useMutedChatAuthors();
  const assetLinks = useChatAssetLinks(messages);
  const [showMuted, setShowMuted] = useState(false);
  const { moderation, showBanned, setShowBanned } = useChatContext();
  const transcript = useRef<HTMLDivElement>(null);
  const composer = useRef<ChatComposerHandle>(null);
  const follow = useRef(true);
  const shown = messages.filter((message) => !authors.some((author) => author.authorId === message.authorId));
  useEffect(() => {
    const node = transcript.current;
    if (node && follow.current) node.scrollTop = node.scrollHeight;
  }, [messages, authors]);
  const statusText = status === "live" ? t("Live") : status === "connecting" ? t("Connecting…") : status === "reconnecting" ? t("Reconnecting…") : t("Offline");
  const runCommand = (command: NonNullable<ReturnType<typeof parseChatCommand>>) => {
    if (command.type === "help") return { clear: true, notice: t("Commands: /mute @name, /unmute @name, /help.") };
    if (command.type === "invalid") return { clear: false, notice: t("Unknown command. Type /help.") };
    const author = resolveChatAuthor(command.handle, messages, authors);
    if (!author) return { clear: false, notice: t("User not found. Use a name from this chat.") };
    if (command.type === "mute") {
      mute(author);
      return { clear: true, notice: t("Muted {name} for you.", { name: author.handle }) };
    }
    unmute(author.authorId);
    return { clear: true, notice: t("Unmuted {name}.", { name: author.handle }) };
  };
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white text-xs dark:border-gray-800 dark:bg-gray-900">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-gray-100 px-3 py-2 dark:border-gray-800">
        <h2 id={titleId} className="flex min-w-0 items-center gap-1.5 font-semibold">{t("Chat")}
          {connections !== null && <span aria-label={t("Chat connections: {n}", { n: num.commas(connections) })} title={t("Approximate number of open chat connections.")} className="text-[10px] font-normal tabular-nums text-gray-500 dark:text-gray-400">({num.commas(connections)})</span>}
        </h2>
        <div className="flex min-w-0 items-center gap-2">
          <span role="status" className="inline-flex min-w-0 items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">{status === "live" && <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-purple-500" />}{statusText}</span>
          {close}
        </div>
      </div>
      <div ref={transcript} role="log" aria-label={t("Chat messages")} aria-live="polite" aria-relevant="additions" tabIndex={0}
        onScroll={(event) => { const node = event.currentTarget; follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48; }}
        className={`min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2 ${FOCUS}`}>
        {shown.length === 0 && <p className="py-3 text-gray-500 dark:text-gray-400">{t("No messages to show.")}</p>}
        {shown.map((message) => (
          <p key={message.id} title={new Date(message.createdAt).toLocaleString(num.intl, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} className="group py-1 leading-relaxed [overflow-wrap:anywhere]">
            <button type="button" onClick={() => composer.current?.mention(message.handle)} title={t("Mention {name}", { name: message.handle })} aria-label={t("Mention {name}", { name: message.handle })}
              className={`font-semibold hover:underline ${message.authorId === identity?.authorId ? "text-purple-600 dark:text-purple-400" : "text-gray-700 dark:text-gray-200"} ${FOCUS}`}>{message.handle}</button>
            <DM.Root>
              <DM.Trigger asChild>
                <button type="button" aria-label={t("Actions for {name}", { name: message.handle })} className={`float-right ms-1 inline-flex size-6 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700 focus:opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100 dark:hover:bg-gray-800 dark:hover:text-gray-200 ${FOCUS}`}>⋯</button>
              </DM.Trigger>
              <DM.Portal><DM.Content align="end" sideOffset={4} className="z-[60] rounded-lg border border-gray-200 bg-white p-1 text-xs shadow-lg dark:border-gray-700 dark:bg-gray-900">
                <DM.Label className="px-3 py-1 text-[10px] tabular-nums text-gray-500 dark:text-gray-400"><time dateTime={new Date(message.createdAt).toISOString()}>{new Date(message.createdAt).toLocaleString(num.intl, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time></DM.Label>
                <DM.Item onSelect={() => mute(message)} className="cursor-pointer rounded px-3 py-2 outline-none data-highlighted:bg-gray-100 dark:data-highlighted:bg-gray-800">{t("Mute {name}", { name: message.handle })}</DM.Item>
                {identity?.isAdmin && message.authorId !== identity.authorId && <DM.Item disabled={moderation.pending !== null} onSelect={() => {
                  void moderation.moderate(message, true).then((ok) => { if (ok !== undefined) { setShowBanned(true); if (ok) void moderation.load(); } });
                }} className="cursor-pointer rounded px-3 py-2 text-red-600 outline-none data-disabled:opacity-40 data-highlighted:bg-gray-100 dark:text-red-400 dark:data-highlighted:bg-gray-800">{t("Ban from chat")}</DM.Item>}
              </DM.Content></DM.Portal>
            </DM.Root>
            {": "}<span className="whitespace-pre-wrap text-gray-700 dark:text-gray-200"><ChatText text={message.text} ownHandle={identity?.handle ?? null} assetLinks={assetLinks} /></span>
          </p>
        ))}
      </div>
      {authors.length > 0 && <div className="shrink-0 border-t border-gray-100 px-3 py-1.5 dark:border-gray-800">
        <button type="button" aria-expanded={showMuted} onClick={() => setShowMuted((value) => !value)} className={`text-gray-500 hover:underline dark:text-gray-400 ${FOCUS}`}>{t("Muted ({n})", { n: num.commas(authors.length) })}</button>
        {showMuted && <ul className="max-h-24 space-y-1 overflow-y-auto py-1">{authors.map((author) => <li key={author.authorId}>
          <button type="button" onClick={() => unmute(author.authorId)} className={`text-purple-600 hover:underline dark:text-purple-400 ${FOCUS}`}>{t("Unmute {name}", { name: author.handle })}</button>
        </li>)}</ul>}
      </div>}
      {identity?.isAdmin && <div data-chat-bans className="shrink-0 border-t border-gray-100 px-3 py-1.5 dark:border-gray-800">
        <button type="button" aria-expanded={showBanned} onClick={() => { setShowBanned((value) => !value); if (!showBanned) void moderation.load(); }} className={`text-gray-500 hover:underline dark:text-gray-400 ${FOCUS}`}>{moderation.loaded ? t("Banned ({n})", { n: num.commas(moderation.bans.length) }) : t("Banned users")}</button>
        {showBanned && <>
          {moderation.error && <p role="alert" className="py-1 text-xs text-red-600 dark:text-red-400">{moderation.error === "load" ? t("Could not load banned users.") : t("Could not update this ban.")}</p>}
          {moderation.loading && <p role="status" className="py-1 text-gray-500">{t("Loading…")}</p>}
          <ul className="max-h-24 space-y-1 overflow-y-auto py-1">
            {moderation.loaded && moderation.bans.length === 0 && <li className="text-gray-500">{t("No banned users.")}</li>}
            {moderation.bans.map((ban) => <li key={ban.authorId}>
              <button type="button" disabled={moderation.pending !== null || moderation.loading} onClick={() => void moderation.moderate(ban, false)} className={`text-purple-600 hover:underline disabled:opacity-40 dark:text-purple-400 ${FOCUS}`}>{t("Unban {name}", { name: ban.handle })}</button>
            </li>)}
          </ul>
        </>}
      </div>}
      <ChatComposer key={address ?? "guest"} ref={composer} drafts={drafts} rememberDraft={rememberDraft} ownHandle={identity?.handle ?? null} acceptMessage={acceptMessage} runCommand={runCommand} />
    </div>
  );
}

/** Personalize only a complete mention token; all other content stays text. */
function ChatText({ text, ownHandle, assetLinks }: { text: string; ownHandle: string | null; assetLinks: ReadonlyMap<string, string> }) {
  const t = useT();
  const { navigateAsset } = useChatContext();
  const tokens: { start: number; end: number; content: React.ReactNode }[] = [];
  for (const tag of parseChatCashtags(text)) {
    const href = assetLinks.get(tag.asset);
    if (href) tokens.push({ start: tag.start, end: tag.end, content: <LazyLink href={href}
      target={tag.asset === "XCP" ? "_blank" : undefined} rel={tag.asset === "XCP" ? "noopener noreferrer" : undefined}
      onNavigate={tag.asset === "XCP" ? undefined : (event) => { event.preventDefault(); navigateAsset(href); }}
      className={`font-medium text-purple-600 hover:underline dark:text-purple-400 ${FOCUS}`}>{tag.tag}</LazyLink> });
  }
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(/@[A-Za-z][A-Za-z0-9_-]*/g)) {
    const index = match.index;
    if (!ownHandle || match[0].slice(1).toLowerCase() !== ownHandle.toLowerCase()) continue;
    const before = index > 0 ? text[index - 1] : "";
    const after = text.slice(index + match[0].length);
    // Exclude email local-part characters and longer identifiers/domains.
    if ((before && /[\p{L}\p{N}.!#$%&'*+/=?^_`{|}~@-]/u.test(before))
      || /^[\p{L}\p{N}_@-]/u.test(after) || /^\.[\p{L}\p{N}]/u.test(after)) continue;
    tokens.push({ start: index, end: index + match[0].length, content: <span data-chat-mention className="rounded bg-purple-100 px-0.5 font-medium text-purple-700 dark:bg-purple-950 dark:text-purple-300">{t("@you")}</span> });
  }
  for (const token of tokens.sort((a, b) => a.start - b.start)) {
    if (token.start < cursor) continue;
    parts.push(text.slice(cursor, token.start));
    parts.push(<span key={token.start}>{token.content}</span>);
    cursor = token.end;
  }
  parts.push(text.slice(cursor));
  return parts;
}

interface ChatComposerHandle { mention: (handle: string) => void }

function ChatComposer({ acceptMessage, ref, drafts, rememberDraft, ownHandle, runCommand }: {
  acceptMessage: (message: ChatMessage) => void;
  ref: Ref<ChatComposerHandle>;
  drafts: Record<string, ChatDraftMemory>;
  rememberDraft: (address: string, update: Partial<ChatDraftMemory>) => void;
  ownHandle: string | null;
  runCommand: (command: NonNullable<ReturnType<typeof parseChatCommand>>) => { clear: boolean; notice: string };
}) {
  const t = useT();
  const num = useNumbers();
  const wallet = useWallet();
  const session = useSession();
  const canPost = wallet.status === "connected" && !!wallet.address && session.address === wallet.address;
  const draftKey = wallet.address ?? "guest";
  const memory = drafts[draftKey];
  const [draft, setDraft] = useState(memory?.draft ?? "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(memory?.error ?? null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldownUntil, setCooldownUntil] = useState(memory?.cooldownUntil ?? 0);
  const [now, setNow] = useState(Date.now);
  const request = useRef(memory?.request ?? null);
  const inFlight = useRef(false);
  const composing = useRef(false);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const guidance = useRef<HTMLDivElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const authorised = useRef(canPost ? wallet.address : null);
  const inputId = useId();
  const helpId = useId();
  const length = Array.from(draft).length;
  const lines = chatLineCount(draft);
  const text = normalizeChatText(draft);
  const command = parseChatCommand(draft);
  const invalid = length > CHAT_MAX_CODEPOINTS || lines > CHAT_MAX_LINES || (draft.trim().length > 0 && text === null);
  const seconds = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  useImperativeHandle(ref, () => ({
    mention(handle) {
      if (wallet.status !== "connected" || !wallet.address) { guidance.current?.focus(); return; }
      pendingCaret.current = -1;
      setNotice(null);
      setDraft((current) => `${current}${current && !/\s$/.test(current) ? " " : ""}@${handle} `);
    },
  }), [wallet.status, wallet.address]);
  useEffect(() => {
    rememberDraft(draftKey, { draft, cooldownUntil, error });
  }, [rememberDraft, draftKey, draft, cooldownUntil, error]);
  useEffect(() => {
    if (pendingCaret.current === null) return;
    const caret = pendingCaret.current < 0 ? draft.length : pendingCaret.current;
    pendingCaret.current = null;
    textarea.current?.focus();
    textarea.current?.setSelectionRange(caret, caret);
  }, [draft]);
  useEffect(() => {
    authorised.current = canPost ? wallet.address : null;
    if (!canPost) controller.current?.abort();
  }, [canPost, wallet.address]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); };
  }, []);
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [cooldownUntil]);

  const insertEmoji = (emoji: string) => {
    if (!canPost) return;
    const node = textarea.current;
    const start = node?.selectionStart ?? draft.length;
    const end = node?.selectionEnd ?? draft.length;
    const caret = start + emoji.length;
    pendingCaret.current = caret;
    setNotice(null);
    setDraft(`${draft.slice(0, start)}${emoji}${draft.slice(end)}`);
    node?.focus();
    node?.setSelectionRange(caret, caret);
  };

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (command) {
      const result = runCommand(command);
      setNotice(result.notice);
      if (result.clear) setDraft("");
      return;
    }
    const address = wallet.address;
    if (!canPost || !address || !text || length > CHAT_MAX_CODEPOINTS || inFlight.current || seconds > 0) return;
    inFlight.current = true;
    const submittedDraft = draft;
    if (request.current?.text !== text || request.current.address !== address) {
      request.current = { text, address, id: crypto.randomUUID() };
      rememberDraft(draftKey, { request: request.current });
    }
    const pendingRequest = request.current;
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 10_000);
    controller.current = abort;
    setSending(true); setError(null); setNotice(null);
    try {
      const response = await fetch("/api/chat", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, text, requestId: pendingRequest.id }), signal: abort.signal,
      });
      const result = await response.json() as { ok?: boolean; message?: unknown; error?: string; retryAfter?: number };
      if (!mounted.current || authorised.current !== address) return;
      const accepted = response.ok && result.ok === true ? parseChatFrame({ type: "message", message: result.message }) : null;
      if (accepted?.type === "message") {
        acceptMessage(accepted.message);
        request.current = null;
        rememberDraft(draftKey, { request: null });
        setDraft((current) => current === submittedDraft ? "" : current);
        setNow(Date.now());
        setCooldownUntil(Date.now() + CHAT_COOLDOWN_MS);
      } else if (result.error === "unauthorized" || result.error === "session_mismatch") {
        setError(t("Reconnect your wallet to verify again."));
        session.invalidate();
      } else if (result.error === "rate_limited") {
        const retryAfter = typeof result.retryAfter === "number" && Number.isFinite(result.retryAfter) ? Math.max(1, Math.min(3600, result.retryAfter)) : CHAT_COOLDOWN_MS / 1000;
        setNow(Date.now()); setCooldownUntil(Date.now() + retryAfter * 1000);
      } else {
        setError(result.error === "disabled" ? t("Chat is disabled.")
          : result.error === "banned" ? t("You are banned from chat.")
          : result.error === "muted" ? t("You cannot post in chat right now.")
          : result.error === "invalid_message" ? t("Message must be 1–{max} characters.", { max: CHAT_MAX_CODEPOINTS })
          : result.error === "unavailable" ? t("Chat is temporarily unavailable.")
          : t("Couldn't send. Your message is still here."));
      }
    } catch {
      if (mounted.current && authorised.current === address) setError(t("Couldn't send. Your message is still here."));
    } finally {
      clearTimeout(timeout);
      inFlight.current = false;
      if (mounted.current) setSending(false);
    }
  };

  return (
    <form onSubmit={send} className="shrink-0 space-y-1.5 border-t border-gray-100 p-2.5 dark:border-gray-800">
      {wallet.status !== "connected" || !wallet.address ? (
        <div ref={guidance} tabIndex={-1} className="text-gray-500 outline-none dark:text-gray-400">{t("Connect a wallet to chat.")}</div>
      ) : <>
        <div className="flex h-6 items-center gap-1">
        {ownHandle && <span className="shrink-0 text-[10px] font-semibold text-purple-600 dark:text-purple-400">{ownHandle}</span>}
        <div ref={guidance} tabIndex={-1} id={helpId} role="status"
          title={seconds > 0 ? t("Wait {n}s before sending again.", { n: num.commas(seconds) }) : undefined}
          aria-label={seconds > 0 && !notice && canPost ? t("Wait {n}s before sending again.", { n: num.commas(seconds) }) : undefined}
          className="h-6 min-w-0 flex-1 overflow-y-auto text-[11px] leading-3 text-gray-500 outline-none dark:text-gray-400">
          <div className="flex min-h-full items-center"><span>
          {notice ?? (!canPost ? <>
            {session.status === "checking" ? t("Verifying wallet…") : session.status === "unauthenticated" ? t("Reconnect your wallet to verify again.") : t("Verify your wallet to chat.")}
            {session.status === "unavailable" && <> {" "}<button type="button" onClick={() => session.retry()} className={`text-purple-600 hover:underline dark:text-purple-400 ${FOCUS}`}>{t("Retry verification")}</button></>}
          </> : lines > CHAT_MAX_LINES ? t("Use at most {max} lines.", { max: CHAT_MAX_LINES })
            : invalid ? t("Message must be 1–{max} characters.", { max: CHAT_MAX_CODEPOINTS })
            : seconds > 0 ? t("Wait {n}s", { n: num.commas(seconds) }) : error)}
          </span></div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {["🐸", "🌽", "🔥", "😂"].map((emoji) => <button key={emoji} type="button" disabled={!canPost} onClick={() => insertEmoji(emoji)} aria-label={t("Insert {emoji}", { emoji })}
            className={`flex size-6 items-center justify-center rounded text-base leading-none hover:bg-gray-100 disabled:opacity-35 dark:hover:bg-gray-800 ${FOCUS}`}>{emoji}</button>)}
        </div>
        </div>
        <label htmlFor={inputId} className="sr-only">{t("Message")}</label>
        <textarea ref={textarea} id={inputId} rows={2} value={draft} onChange={(event) => { setDraft(event.target.value); setNotice(null); }}
          onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
          onKeyDown={(event) => {
            // IME confirmation is text input, including Safari's legacy229
            // event after compositionend. Shift+Enter keeps a normal newline.
            if (event.key !== "Enter" || event.shiftKey || composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }}
          aria-describedby={helpId} aria-invalid={invalid}
          className={`block w-full resize-none rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 text-sm text-gray-900 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 ${FOCUS}`} />
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-[10px]">
            <span className="tabular-nums text-gray-500 dark:text-gray-400">{t("{n}/{max}", { n: num.commas(length), max: CHAT_MAX_CODEPOINTS })}</span>
          </span>
          <button type="submit" disabled={!command && (!canPost || !text || length > CHAT_MAX_CODEPOINTS || sending || seconds > 0)} className={`min-h-8 rounded-full bg-gray-900 px-3 py-1 text-xs font-semibold text-white disabled:opacity-40 dark:bg-gray-100 dark:text-gray-900 ${FOCUS}`}>{sending && !command ? t("Sending…") : t("Send")}</button>
        </div>
      </>}
    </form>
  );
}
