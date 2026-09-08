// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatPanel } from "@/components/chat-panel";
import { LocaleProvider } from "@/lib/i18n/client";
import { CHAT_COOLDOWN_MS, chatHandle, type ChatMessage } from "@launchpad/chat";
import { ChatProvider, useChatRoute } from "@/providers/chat-context";

const boundary = vi.hoisted(() => ({
  wallet: { status: "connected", address: "wallet-one" as string | null },
  session: { address: "wallet-one" as string | null, status: "authenticated", retry: vi.fn(), invalidate: vi.fn() },
  fetch: vi.fn(), identity: vi.fn(), moderation: vi.fn(), desktop: true, assetLinks: new Map<string, string>(), pathname: "/SAMPLE", push: vi.fn(),
}));
vi.mock("@/lib/wallet/wallet-context", () => ({ useWallet: () => boundary.wallet }));
vi.mock("@/providers/session-context", () => ({ useSession: () => boundary.session }));
vi.mock("@/hooks/use-chat-assets", () => ({ useChatAssetLinks: () => boundary.assetLinks }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ prefetch: vi.fn(), push: boundary.push }), usePathname: () => boundary.pathname }));
vi.mock("next/link", () => ({ default: ({ prefetch: _prefetch, onNavigate, ...props }: ComponentProps<"a"> & { prefetch?: boolean; onNavigate?: (event: { preventDefault(): void }) => void }) => <a {...props} onClick={(event) => { event.preventDefault(); if (props.target !== "_blank" && !event.ctrlKey && !event.metaKey) onNavigate?.(event); }} /> }));

class Socket {
  static all: Socket[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(readonly url: string) { Socket.all.push(this); }
  close() { this.closed = true; this.onclose?.(); }
  open() { this.onopen?.(); }
  frame(value: unknown) { this.onmessage?.({ data: typeof value === "string" ? value : JSON.stringify(value) }); }
}
let root: Root;
let container: HTMLDivElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const newestSocket = () => Socket.all.at(-1)!;
const HANDLE_A = chatHandle("a".repeat(64));
const message = (n = 1, text = "A shared public message"): ChatMessage => ({
  id: `message_${String(n).padStart(8, "0")}`, authorId: n % 2 ? "a".repeat(64) : "b".repeat(64),
  handle: chatHandle(n % 2 ? "a".repeat(64) : "b".repeat(64)), text, createdAt: Date.now() + n,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks(); Socket.all = []; boundary.desktop = true; boundary.assetLinks = new Map(); boundary.pathname = "/SAMPLE";
  boundary.wallet = { status: "connected", address: "wallet-one" };
  boundary.session = { address: "wallet-one", status: "authenticated", retry: vi.fn(), invalidate: vi.fn() };
  boundary.fetch.mockRejectedValue(new Error("No transport response configured"));
  boundary.identity.mockImplementation(async () => Response.json({ address: boundary.wallet.address, authorId: "a".repeat(64), handle: HANDLE_A }));
  boundary.moderation.mockResolvedValue(Response.json({ bans: [] }));
  localStorage.clear();
  vi.stubGlobal("fetch", (url: string, options?: RequestInit) => url === "/api/chat/moderation" ? boundary.moderation(url, options) : options?.method === "GET" ? boundary.identity(url, options) : boundary.fetch(url, options));
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("matchMedia", () => ({ matches: boundary.desktop, addEventListener() {}, removeEventListener() {} }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount()); container.remove();
  vi.useRealTimers(); vi.unstubAllGlobals();
});
async function render() {
  await act(async () => root.render(<LocaleProvider locale="en" messages={{}}><ChatProvider><ChatTestPage /></ChatProvider></LocaleProvider>));
  await act(() => window.dispatchEvent(new StorageEvent("storage", { key: null })));
}
function ChatTestPage() { useChatRoute("SAMPLE", true); return <ChatPanel />; }
async function click(node: HTMLElement) { expect(node).toBeTruthy(); await act(() => node.click()); }
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.getAttribute("aria-label") === label || node.textContent === label)!;
const input = () => document.querySelector<HTMLTextAreaElement>("textarea")!;
async function type(text: string) {
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input(), text);
    input().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit(twice = false) {
  await act(async () => {
    document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    if (twice) document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
}
const transcript = () => document.querySelector('[role="log"]')!;
const posted = (n = 0) => JSON.parse(boundary.fetch.mock.calls[n]![1].body);

describe("chat transcript and socket lifecycle", () => {
  it("reads public history without connecting a wallet and renders message text as text", async () => {
    boundary.wallet = { status: "disconnected", address: null }; boundary.session.address = null;
    await render();
    expect(Socket.all).toHaveLength(1);
    expect(newestSocket().url).toBe("wss://api.xcp.fun/ws/chat");
    await act(() => { newestSocket().open(); newestSocket().frame({ type: "history", messages: [message(1, "<script>alert(1)</script> 日本語 🚀")] }); });
    expect(transcript().textContent).toContain("<script>alert(1)</script> 日本語 🚀");
    expect(transcript().querySelector("script")).toBeNull();
    expect(document.body.textContent).toContain("Connect a wallet to chat.");
    expect(document.body.textContent).not.toContain("a".repeat(64));
    expect(input()).toBeNull(); expect(boundary.fetch).not.toHaveBeenCalled();
  });

  it("opens no mobile socket until the sheet opens, then closes on Escape and returns focus", async () => {
    boundary.desktop = false; await render();
    expect(Socket.all).toHaveLength(0);
    const trigger = button("Open chat"); trigger.focus(); await click(trigger);
    expect(Socket.all).toHaveLength(1);
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    expect(document.querySelector('[role="dialog"]')!.contains(document.activeElement)).toBe(true);
    await act(() => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(newestSocket().closed).toBe(true);
    expect(document.activeElement).toBe(trigger);
  });

  it("deduplicates messages, bounds history, replaces it on reconnect and ignores stale/malformed frames", async () => {
    vi.useFakeTimers(); await render();
    const first = newestSocket();
    await act(() => first.frame({ type: "history", messages: Array.from({ length: 50 }, (_, n) => message(n + 1, `history ${n}`)) }));
    await act(() => { first.frame({ type: "message", message: message(51, "latest") }); first.frame({ type: "message", message: message(51, "latest") }); first.frame("x".repeat(100001)); });
    expect(transcript().querySelectorAll("p")).toHaveLength(50);
    expect(transcript().textContent).not.toContain("history 0");
    await act(() => first.close());
    await act(async () => vi.advanceTimersByTime(1001));
    expect(Socket.all).toHaveLength(2);
    await act(() => { newestSocket().frame({ type: "history", messages: [message(99, "replacement")] }); first.frame({ type: "message", message: message(100, "stale socket") }); });
    expect(transcript().querySelectorAll("p")).toHaveLength(1);
    expect(transcript().textContent).toContain("replacement");
    expect(transcript().textContent).not.toContain("stale socket");
    await act(() => root.unmount());
    await act(async () => vi.advanceTimersByTime(60000));
    expect(Socket.all).toHaveLength(2);
    root = createRoot(container);
  });

  it("mutes only the selected author locally and can restore their messages", async () => {
    await render();
    await act(() => newestSocket().frame({ type: "history", messages: [message(1, "alpha text"), message(2, "beta text")] }));
    await act(() => button(`Actions for ${HANDLE_A}`).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" })));
    await click(document.querySelector<HTMLElement>('[role="menuitem"]')!);
    expect(transcript().textContent).not.toContain("alpha text"); expect(transcript().textContent).toContain("beta text");
    await click(button("Muted (1)")); await click(button(`Unmute ${HANDLE_A}`));
    expect(transcript().textContent).toContain("alpha text");
    expect(boundary.fetch).not.toHaveBeenCalled();
  });

  it("appends a spaced mention and focuses the composer without muting the author", async () => {
    await render(); await type("hello");
    await act(() => newestSocket().frame({ type: "history", messages: [message(1, "still visible")] }));
    await click(button(`Mention ${HANDLE_A}`));
    expect(input().value).toBe(`hello @${HANDLE_A} `); expect(document.activeElement).toBe(input());
    expect(input().selectionStart).toBe(input().value.length); expect(transcript().textContent).toContain("still visible");
    expect(button("Muted (1)")).toBeUndefined(); expect(boundary.fetch).not.toHaveBeenCalled();
  });

  it("focuses connection guidance when a guest clicks a username", async () => {
    boundary.wallet = { status: "disconnected", address: null }; boundary.session.address = null;
    await render(); await act(() => newestSocket().frame({ type: "history", messages: [message()] }));
    await click(button(`Mention ${HANDLE_A}`));
    expect(document.activeElement!.textContent).toBe("Connect a wallet to chat.");
    expect(input()).toBeNull(); expect(boundary.fetch).not.toHaveBeenCalled();
  });
});

describe("chat writes require the current verified wallet", () => {
  it("blocks a mismatched session and asks for wallet reconnection", async () => {
    boundary.session.address = "another-wallet"; boundary.session.status = "unauthenticated";
    await render();
    expect(input().disabled).toBe(false); expect(button("Send").disabled).toBe(true);
    expect(document.body.textContent).toContain("Reconnect your wallet to verify again.");
    expect(button("Retry verification")).toBeUndefined();
    expect(boundary.fetch).not.toHaveBeenCalled();
  });

  it("offers an explicit retry for an unavailable session service", async () => {
    boundary.session.address = null; boundary.session.status = "unavailable";
    await render(); await click(button("Retry verification"));
    expect(boundary.session.retry).toHaveBeenCalledTimes(1); expect(boundary.fetch).not.toHaveBeenCalled();
  });

  it("counts 280 emoji as 280 codepoints and never silently truncates an over-limit draft", async () => {
    await render(); await type("🚀".repeat(280));
    expect(button("Send").disabled).toBe(false); expect(document.body.textContent).toContain("280/280");
    await type("🚀".repeat(281)); expect(button("Send").disabled).toBe(true);
    expect(input().value).toBe("🚀".repeat(281));
    await submit(); expect(boundary.fetch).not.toHaveBeenCalled();
  });

  it("waits for acceptance, sends once per submit, keeps newer draft edits and deduplicates its socket echo", async () => {
    const pending = deferred<Response>(); boundary.fetch.mockReturnValue(pending.promise);
    await render(); await type("message being sent"); await submit(true);
    expect(boundary.fetch).toHaveBeenCalledTimes(1); expect(transcript().textContent).not.toContain("message being sent");
    expect(posted()).toMatchObject({ address: "wallet-one", text: "message being sent" });
    await type("a newer draft");
    const accepted = message(1, "message being sent");
    await act(async () => pending.resolve(Response.json({ ok: true, message: accepted })));
    expect(input().value).toBe("a newer draft");
    await act(() => newestSocket().frame({ type: "message", message: accepted }));
    expect(transcript().querySelectorAll("p")).toHaveLength(1);
    expect(button("Send").disabled).toBe(true);
  });

  it("preserves a failed message and reuses its request ID on retry", async () => {
    boundary.fetch.mockRejectedValueOnce(new Error("connection lost"));
    await render(); await type("retry this exact message"); await submit();
    expect(input().value).toBe("retry this exact message");
    expect(document.body.textContent).toContain("Couldn't send. Your message is still here.");
    boundary.fetch.mockResolvedValueOnce(Response.json({ ok: true, message: message(1, "retry this exact message") }));
    await submit(); expect(posted(1).requestId).toBe(posted(0).requestId); expect(input().value).toBe("");
  });

  it("times out a stalled send and leaves a retry with the same request ID", async () => {
    vi.useFakeTimers();
    boundary.fetch.mockImplementationOnce((_url: string, options: RequestInit) => new Promise((_resolve, reject) => options.signal!.addEventListener("abort", () => reject(new Error("aborted")))));
    await render(); await type("a stalled message"); await submit();
    expect(button("Sending…").disabled).toBe(true);
    await act(async () => vi.advanceTimersByTime(10001));
    expect(input().value).toBe("a stalled message"); expect(button("Send").disabled).toBe(false);
    await submit(); expect(posted(1).requestId).toBe(posted(0).requestId);
  });

  it("invalidates an expired session and keeps the failed draft for explicit recovery", async () => {
    boundary.fetch.mockResolvedValueOnce(Response.json({ error: "unauthorized" }, { status: 401 }));
    await render(); await type("keep this draft"); await submit();
    expect(boundary.session.invalidate).toHaveBeenCalledTimes(1); expect(input().value).toBe("keep this draft");
    boundary.session.address = null; boundary.session.status = "unauthenticated"; await render();
    expect(input().value).toBe("keep this draft"); expect(button("Send").disabled).toBe(true);
    expect(document.body.textContent).toContain("Reconnect your wallet to verify again.");
  });

  it.each(["acceptance", "unauthorized"])("ignores an old account's in-flight %s after switching wallets", async (outcome) => {
    const pending = deferred<Response>(); boundary.fetch.mockReturnValueOnce(pending.promise);
    await render(); await type("old wallet message"); await submit();
    boundary.wallet.address = "wallet-two"; boundary.session.address = "wallet-two"; await render();
    await type("new wallet draft");
    await act(async () => pending.resolve(outcome === "acceptance"
      ? Response.json({ ok: true, message: message(1, "old wallet message") })
      : Response.json({ error: "unauthorized" }, { status: 401 })));
    expect(input().value).toBe("new wallet draft"); expect(transcript().textContent).not.toContain("old wallet message");
    expect(boundary.session.invalidate).not.toHaveBeenCalled();
  });

  it("keeps rate-limited drafts and uses a local cooldown after acceptance despite server clock skew", async () => {
    vi.useFakeTimers(); boundary.fetch.mockResolvedValueOnce(Response.json({ error: "rate_limited", retryAfter: 2 }, { status: 429 }));
    await render(); await type("wait briefly"); await submit();
    expect(input().value).toBe("wait briefly"); expect(button("Send").disabled).toBe(true);
    await act(async () => vi.advanceTimersByTime(2001)); expect(button("Send").disabled).toBe(false);
    boundary.fetch.mockResolvedValueOnce(Response.json({ ok: true, message: { ...message(1, "wait briefly"), createdAt: Date.now() + 600000 } }));
    await submit(); await type("next message"); expect(button("Send").disabled).toBe(true);
    await act(async () => vi.advanceTimersByTime(CHAT_COOLDOWN_MS + 1)); expect(button("Send").disabled).toBe(false);
  });

  it("sends once on Enter while Shift+Enter remains ordinary multiline input", async () => {
    const pending = deferred<Response>(); boundary.fetch.mockReturnValue(pending.promise);
    await render(); await type("line one");
    const shift = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true });
    await act(() => input().dispatchEvent(shift));
    expect(shift.defaultPrevented).toBe(false); expect(boundary.fetch).not.toHaveBeenCalled();
    await type("line one\nline two");
    const enter = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    await act(() => { input().dispatchEvent(enter); input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
    expect(enter.defaultPrevented).toBe(true); expect(boundary.fetch).toHaveBeenCalledTimes(1);
    expect(posted().text).toBe("line one\nline two");
    await act(async () => pending.resolve(Response.json({ ok: true, message: message(1, "line one\nline two") })));
  });

  it("never sends composition-confirmation Enter, including Safari keyCode229", async () => {
    await render(); await type("日本語 中文 한국어");
    await act(() => input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true })));
    await act(() => input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true, cancelable: true })));
    await act(() => input().dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })));
    await act(() => input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    await act(() => input().dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })));
    expect(boundary.fetch).not.toHaveBeenCalled(); expect(input().value).toBe("日本語 中文 한국어");
  });

  it("retains an over-three-line paste with an error and accepts three lines on Enter", async () => {
    await render(); await type("one\ntwo\nthree\nfour");
    expect(input().value).toBe("one\ntwo\nthree\nfour"); expect(input().getAttribute("aria-invalid")).toBe("true");
    expect(document.body.textContent).toContain("Use at most 3 lines.");
    await act(() => input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    expect(boundary.fetch).not.toHaveBeenCalled();
    await type("one\ntwo\nthree");
    expect(input().getAttribute("aria-invalid")).toBe("false");
    await act(() => input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })));
    expect(boundary.fetch).toHaveBeenCalledTimes(1); expect(posted().text).toBe("one\ntwo\nthree");
  });
});

describe("chat local controls and identity", () => {
  it("keeps a failed draft and its retry ID through mobile close and reopen", async () => {
    boundary.desktop = false; await render(); await click(button("Open chat"));
    await type("keep across closing"); await submit();
    const firstId = posted().requestId;
    await click(button("Close chat")); await click(button("Open chat"));
    expect(input().value).toBe("keep across closing");
    await submit(); expect(posted(1).requestId).toBe(firstId);
  });

  it("collapses desktop chat, closes its socket, preserves its draft and remembers the choice", async () => {
    await render(); await type("desktop draft"); const socket = newestSocket();
    await click(button("Collapse chat"));
    expect(socket.closed).toBe(true); expect(document.querySelector(".chat-sidebar")).toBeNull();
    expect(localStorage.getItem("xcpfun:chat-collapsed:v1")).toBe("1");
    await render(); expect(document.querySelector(".chat-sidebar")).toBeNull();
    await click(button("Open chat"));
    expect(document.querySelector(".chat-sidebar")).toBeTruthy(); expect(input().value).toBe("desktop draft");
    expect(Socket.all).toHaveLength(2); expect(boundary.identity).toHaveBeenCalledTimes(1);
  });

  it("uses the private identity only for own-name styling and never shows its address", async () => {
    await render(); await act(() => newestSocket().frame({ type: "history", messages: [message(1), message(2)] }));
    expect(boundary.identity).toHaveBeenCalledTimes(1);
    expect(button(`Mention ${HANDLE_A}`).className).toContain("text-purple-600");
    expect(button(`Mention ${chatHandle("b".repeat(64))}`).className).toContain("text-gray-700");
    expect(document.body.textContent).not.toContain("wallet-one"); expect(document.body.textContent).not.toContain("a".repeat(64));
    expect(transcript().querySelector("time")).toBeNull();
  });

  it("ignores mismatched and late identity responses after an account change", async () => {
    const pending = deferred<Response>(); boundary.identity.mockReturnValueOnce(pending.promise);
    await render(); boundary.wallet.address = "wallet-two"; boundary.session.address = "wallet-two";
    boundary.identity.mockResolvedValueOnce(Response.json({ address: "wallet-one", authorId: "a".repeat(64), handle: HANDLE_A }));
    await render(); await act(async () => pending.resolve(Response.json({ address: "wallet-one", authorId: "a".repeat(64), handle: HANDLE_A })));
    await act(() => newestSocket().frame({ type: "history", messages: [message(1)] }));
    expect(button(`Mention ${HANDLE_A}`).className).not.toContain("text-purple-600");
  });

  it("executes help and mute/unmute commands locally without a verified posting session", async () => {
    boundary.session.address = null; boundary.session.status = "unauthenticated";
    await render(); await act(() => newestSocket().frame({ type: "history", messages: [message(1, "mute this locally")] }));
    await type("/help"); await submit();
    expect(input().value).toBe(""); expect(document.body.textContent).toContain("Commands: /mute @name, /unmute @name, /help.");
    await type(`/mute @${HANDLE_A}`); await submit();
    expect(input().value).toBe(""); expect(transcript().textContent).not.toContain("mute this locally");
    expect(document.body.textContent).toContain(`Muted ${HANDLE_A} for you.`);
    await type(`@${HANDLE_A} /unmute`); await submit();
    expect(transcript().textContent).toContain("mute this locally"); expect(input().value).toBe("");
    expect(boundary.fetch).not.toHaveBeenCalled(); expect(boundary.identity).not.toHaveBeenCalled();
  });

  it("retains malformed or unknown command drafts without broadcasting them", async () => {
    await render(); await type("/send this is not a command"); await submit();
    expect(input().value).toBe("/send this is not a command"); expect(document.body.textContent).toContain("Unknown command. Type /help.");
    await type("/mute @NotInThisChat"); await submit();
    expect(input().value).toBe("/mute @NotInThisChat"); expect(document.body.textContent).toContain("User not found. Use a name from this chat.");
    expect(boundary.fetch).not.toHaveBeenCalled();
  });

  it("personalizes only complete case-insensitive mentions, retaining emails, prefixes, literal @you and escaped HTML", async () => {
    await render();
    const text = `@${HANDLE_A} (@${HANDLE_A.toLowerCase()}) @${HANDLE_A}MORE person@${HANDLE_A} email+@${HANDLE_A}.com @you <img src=x> @${chatHandle("b".repeat(64))}`;
    await act(() => newestSocket().frame({ type: "history", messages: [message(2, text)] }));
    expect(transcript().querySelectorAll("[data-chat-mention]")).toHaveLength(2);
    expect(transcript().textContent).toContain(`@${HANDLE_A}MORE person@${HANDLE_A} email+@${HANDLE_A}.com @you <img src=x>`);
    expect(transcript().querySelector("img")).toBeNull();
    expect(transcript().textContent).toContain(`@${chatHandle("b".repeat(64))}`);
  });

  it("repersonalizes history only for the newly verified wallet identity", async () => {
    const nextHandle = chatHandle("c".repeat(64));
    await render(); await act(() => newestSocket().frame({ type: "history", messages: [message(2, `@${HANDLE_A} and @${nextHandle}`)] }));
    expect(transcript().textContent).toContain(`@you and @${nextHandle}`);
    boundary.wallet.address = "wallet-two"; boundary.session.address = "wallet-two";
    boundary.identity.mockResolvedValueOnce(Response.json({ address: "wallet-two", authorId: "c".repeat(64), handle: nextHandle }));
    await render();
    expect(transcript().textContent).toContain(`@${HANDLE_A} and @you`);
    expect(transcript().querySelectorAll("[data-chat-mention]")).toHaveLength(1);
  });

  it("inserts a quick emoji at the textarea selection, restores focus and never auto-sends", async () => {
    await render(); await type("hello world"); input().setSelectionRange(6, 11);
    await click(button("Insert 🐸"));
    expect(input().value).toBe("hello 🐸"); expect(document.activeElement).toBe(input());
    expect(input().selectionStart).toBe(8); expect(document.body.textContent).toContain("7/280");
    expect(boundary.fetch).not.toHaveBeenCalled();
    await type("a".repeat(280)); input().setSelectionRange(280, 280); await click(button("Insert 🔥"));
    expect(input().value).toBe("a".repeat(280) + "🔥"); expect(button("Send").disabled).toBe(true);
  });

  it("disables quick emojis until the selected wallet has a verified session", async () => {
    boundary.session.address = null; boundary.session.status = "unauthenticated";
    await render(); expect(button("Insert 😂").disabled).toBe(true);
    await type("/help"); expect(button("Send").disabled).toBe(false);
  });

  it("offers frog, corn, fire and laughter in that order and inserts corn as plain text", async () => {
    await render();
    expect([...document.querySelectorAll('button[aria-label^="Insert "]')].map((node) => node.textContent)).toEqual(["🐸", "🌽", "🔥", "😂"]);
    await type("hello "); await click(button("Insert 🌽"));
    expect(input().value).toBe("hello 🌽"); expect(document.activeElement).toBe(input());
    expect(boundary.fetch).not.toHaveBeenCalled();
  });
});

describe("chat connections and private moderation", () => {
  const handleB = chatHandle("b".repeat(64));
  const banB = () => ({ authorId: "b".repeat(64), handle: handleB, createdAt: Date.now() });
  const admin = () => boundary.identity.mockResolvedValue(Response.json({ address: "wallet-one", authorId: "a".repeat(64), handle: HANDLE_A, isAdmin: true }));
  const openActions = async (handle: string) => act(() => button(`Actions for ${handle}`).dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" })));
  const menuItem = (label: string) => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((node) => node.textContent === label)!;

  it("shows server connection counts separately, updates presence and hides stale counts during reconnect", async () => {
    await render(); const socket = newestSocket();
    await act(() => { socket.open(); socket.frame({ type: "history", messages: [], count: 12 }); });
    expect(document.querySelector('[aria-label="Chat connections: 12"]')).toBeTruthy();
    await act(() => socket.frame({ type: "presence", count: 9 }));
    expect(document.querySelector('[aria-label="Chat connections: 9"]')).toBeTruthy();
    await act(() => socket.frame({ type: "presence", count: -1 }));
    expect(document.querySelector('[aria-label="Chat connections: 9"]')).toBeTruthy();
    await act(() => socket.close());
    expect(document.querySelector('[aria-label^="Chat connections:"]')).toBeNull();
  });

  it("never exposes moderation or reads the ban list for an ordinary verified wallet", async () => {
    await render(); await act(() => newestSocket().frame({ type: "history", messages: [message(2)] }));
    await openActions(handleB);
    expect(button("Banned users")).toBeUndefined(); expect(menuItem("Ban from chat")).toBeUndefined();
    expect(menuItem(`Mute ${handleB}`)).toBeTruthy(); expect(boundary.moderation).not.toHaveBeenCalled();
  });

  it("allows the verified admin to ban another author while preserving local mute and admin identity after posting", async () => {
    admin(); boundary.moderation.mockResolvedValueOnce(Response.json({ ok: true }));
    await render(); await act(() => newestSocket().frame({ type: "history", messages: [message(1), message(2)] }));
    await openActions(handleB); expect(menuItem(`Mute ${handleB}`)).toBeTruthy();
    await click(menuItem("Ban from chat"));
    expect(JSON.parse(boundary.moderation.mock.calls[0][1].body)).toEqual({ address: "wallet-one", authorId: "b".repeat(64), banned: true });
    expect(transcript().textContent).toContain(handleB);
    boundary.fetch.mockResolvedValueOnce(Response.json({ ok: true, message: message(3, "admin message") }));
    await type("admin message"); await submit(); expect(document.querySelector("[data-chat-bans]")).toBeTruthy();
    await openActions(HANDLE_A); expect(menuItem("Ban from chat")).toBeUndefined();
  });

  it("loads bans only on opening moderation, preserves a failed unban and removes it only on success", async () => {
    admin(); boundary.moderation.mockResolvedValueOnce(Response.json({ bans: [banB()] }));
    await render(); expect(boundary.moderation).not.toHaveBeenCalled();
    await click(button("Banned users")); expect(boundary.moderation).toHaveBeenCalledTimes(1);
    expect(boundary.moderation.mock.calls[0][1].method).toBe("GET");
    boundary.moderation.mockResolvedValueOnce(Response.json({ error: "unavailable" }, { status: 503 }));
    await click(button(`Unban ${handleB}`));
    expect(button(`Unban ${handleB}`)).toBeTruthy(); expect(document.body.textContent).toContain("Could not update this ban.");
    boundary.moderation.mockResolvedValueOnce(Response.json({ ok: true })); await click(button(`Unban ${handleB}`));
    expect(button(`Unban ${handleB}`)).toBeUndefined(); expect(document.body.textContent).toContain("No banned users.");
    expect(JSON.parse(boundary.moderation.mock.calls[2][1].body)).toEqual({ address: "wallet-one", authorId: "b".repeat(64), banned: false });
  });

  it("shows a failed ban without claiming success or hiding the author's messages", async () => {
    admin(); boundary.moderation.mockResolvedValueOnce(Response.json({ error: "unavailable" }, { status: 503 }));
    await render(); await act(() => newestSocket().frame({ type: "history", messages: [message(2, "still here")] }));
    await openActions(handleB); await click(menuItem("Ban from chat"));
    expect(document.body.textContent).toContain("Could not update this ban.");
    expect(transcript().textContent).toContain("still here");
    expect(button(`Unban ${handleB}`)).toBeUndefined();
  });

  it("ignores an old admin's delayed ban failure after switching wallets", async () => {
    admin(); const pending = deferred<Response>(); boundary.moderation.mockReturnValueOnce(pending.promise);
    await render(); await act(() => newestSocket().frame({ type: "history", messages: [message(2)] }));
    await openActions(handleB); await click(menuItem("Ban from chat"));
    boundary.wallet.address = "wallet-two"; boundary.session.address = "wallet-two";
    boundary.identity.mockResolvedValueOnce(Response.json({ address: "wallet-two", authorId: "c".repeat(64), handle: chatHandle("c".repeat(64)), isAdmin: false }));
    await render(); await act(async () => pending.resolve(Response.json({ error: "unavailable" }, { status: 503 })));
    expect(document.querySelector("[data-chat-bans]")).toBeNull(); expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).not.toContain("Could not update this ban.");
  });

  it("distinguishes a server ban from personal mute and preserves the rejected draft", async () => {
    boundary.fetch.mockResolvedValueOnce(Response.json({ error: "banned" }, { status: 403 }));
    await render(); await type("rejected message"); await submit();
    expect(document.body.textContent).toContain("You are banned from chat."); expect(input().value).toBe("rejected message");
  });

  it("links only indexed cashtags and preserves mixed mentions, unknown tags and escaped markup", async () => {
    boundary.assetLinks = new Map([["PEPE", "/PEPE"], ["NAKAMOTO", "/NAKAMOTO"]]);
    await render();
    const text = `@${HANDLE_A} $pepe and $NAKAMOTO, $UNKNOWN <img title="$PEPE"> $PEPE.child`;
    await act(() => newestSocket().frame({ type: "history", messages: [message(2, text)] }));
    const links = [...transcript().querySelectorAll("a")];
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([["$pepe", "/PEPE"], ["$NAKAMOTO", "/NAKAMOTO"]]);
    expect(transcript().querySelector(".whitespace-pre-wrap")!.textContent).toBe('@you $pepe and $NAKAMOTO, $UNKNOWN <img title="$PEPE"> $PEPE.child');
    expect(transcript().querySelector("img")).toBeNull();
  });

  it("keeps cashtag links in the selected language for guest readers", async () => {
    boundary.wallet = { status: "disconnected", address: null }; boundary.session.address = null;
    boundary.assetLinks = new Map([["PEPE", "/PEPE"]]);
    boundary.pathname = "/ja/SAMPLE";
    await act(async () => root.render(<LocaleProvider locale="ja" messages={{}}><ChatProvider><ChatTestPage /></ChatProvider></LocaleProvider>));
    await act(() => window.dispatchEvent(new StorageEvent("storage", { key: null })));
    await act(() => newestSocket().frame({ type: "history", messages: [message(2, "$PEPE")] }));
    expect(transcript().querySelector("a")!.getAttribute("href")).toBe("/ja/PEPE");
    expect(boundary.fetch).not.toHaveBeenCalled(); expect(boundary.identity).not.toHaveBeenCalled();
  });

  it("opens XCP in a separate localized tab while ordinary asset links use the shared chat navigation", async () => {
    boundary.assetLinks = new Map([["XCP", "/dispense"], ["PEPE", "/PEPE"]]); boundary.pathname = "/ja/SAMPLE";
    await act(async () => root.render(<LocaleProvider locale="ja" messages={{}}><ChatProvider><ChatTestPage /></ChatProvider></LocaleProvider>));
    await act(() => window.dispatchEvent(new StorageEvent("storage", { key: null })));
    await act(() => newestSocket().frame({ type: "history", messages: [message(2, "$XCP $PEPE")] }));
    const [xcp, asset] = [...transcript().querySelectorAll("a")];
    expect(xcp.getAttribute("href")).toBe("/ja/dispense"); expect(xcp.target).toBe("_blank"); expect(xcp.rel).toBe("noopener noreferrer");
    await click(xcp); expect(boundary.push).not.toHaveBeenCalled();
    await click(asset); expect(boundary.push).toHaveBeenCalledWith("/ja/PEPE");
    expect(Socket.all).toHaveLength(1); expect(newestSocket().closed).toBe(false);
  });
});
