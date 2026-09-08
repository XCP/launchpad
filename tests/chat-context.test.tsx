// @vitest-environment happy-dom
import { act, Component, Suspense, use, useState, type Context, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatProvider, useChatContext, useChatRoute } from "@/providers/chat-context";
import { chatHandle } from "@launchpad/chat";

const boundary = vi.hoisted(() => ({
  Path: null as unknown as Context<string>, navigate: (_href: string) => {},
  router: { push: vi.fn((href: string) => boundary.navigate(href)) },
  wallet: { status: "connected", address: "wallet-one" as string | null },
  session: { address: "wallet-one" as string | null },
  desktop: true, locale: "en", fetch: vi.fn(),
}));
vi.mock("next/navigation", async () => {
  const React = await import("react");
  boundary.Path = React.createContext("/PEPE");
  return { usePathname: () => React.useContext(boundary.Path), useRouter: () => boundary.router };
});
vi.mock("@/lib/i18n/client", () => ({ useLocale: () => boundary.locale }));
vi.mock("@/lib/wallet/wallet-context", () => ({ useWallet: () => boundary.wallet }));
vi.mock("@/providers/session-context", () => ({ useSession: () => boundary.session }));

class Socket {
  static all: Socket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  closed = false;
  constructor(readonly url: string) { Socket.all.push(this); }
  close() { this.closed = true; this.onclose?.(); }
  open() { this.onopen?.(); }
}
type PageSpec = { asset?: string; eligible?: boolean; wait?: Promise<void> };
let pages: Record<string, PageSpec>;
let current: ReturnType<typeof useChatContext>;
let root: Root;
let container: HTMLDivElement;
const authorId = "a".repeat(64);
const mediaListeners = new Set<() => void>();
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
class PageError extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p>Page failed</p> : this.props.children; }
}
function ResolvedPage({ asset, eligible }: { asset: string; eligible: boolean }) {
  useChatRoute(asset, eligible);
  return <p data-page={asset}>{asset}</p>;
}
function Page({ path }: { path: string }) {
  const page = pages[path];
  if (page?.wait) use(page.wait);
  return page?.asset ? <ResolvedPage asset={page.asset} eligible={page.eligible !== false} /> : <p>Non-chat page</p>;
}
function Probe() {
  current = useChatContext();
  return <output>{current.status}</output>;
}
function App({ initial = "/PEPE" }: { initial?: string }) {
  const [path, setPath] = useState(initial);
  boundary.navigate = setPath;
  return <boundary.Path.Provider value={path}><ChatProvider>
    <Probe />
    <PageError><Suspense fallback={<p>Loading page</p>}><Page key={path} path={path} /></Suspense></PageError>
  </ChatProvider></boundary.Path.Provider>;
}
async function mount(initial = "/PEPE") {
  await act(async () => { root.render(<App initial={initial} />); });
  await act(() => window.dispatchEvent(new StorageEvent("storage", { key: null })));
}
async function navigate(href: string) { await act(() => current.navigateAsset(href)); }

beforeEach(() => {
  vi.clearAllMocks(); Socket.all = []; mediaListeners.clear(); localStorage.clear();
  boundary.desktop = true; boundary.locale = "en";
  boundary.wallet = { status: "connected", address: "wallet-one" };
  boundary.session = { address: "wallet-one" };
  pages = { "/PEPE": { asset: "PEPE" }, "/FROG": { asset: "FROG" }, "/DEAD": { asset: "DEAD", eligible: false } };
  boundary.fetch.mockImplementation(async (url: string) => url === "/api/chat/moderation"
    ? Response.json({ bans: [{ authorId, handle: chatHandle(authorId), createdAt: Date.now() }] })
    : Response.json({ address: boundary.wallet.address, authorId, handle: chatHandle(authorId), isAdmin: true }));
  vi.stubGlobal("fetch", boundary.fetch); vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("matchMedia", () => ({ matches: boundary.desktop, addEventListener: (_type: string, fn: () => void) => mediaListeners.add(fn), removeEventListener: (_type: string, fn: () => void) => mediaListeners.delete(fn) }));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount()); container.remove();
  vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe("persistent chat asset navigation", () => {
  it("keeps one socket and identity across eligible remounts and same-route clicks", async () => {
    await mount(); await act(() => Socket.all[0].open());
    await navigate("/FROG"); await navigate("/FROG"); await navigate("/PEPE");
    expect(Socket.all).toHaveLength(1); expect(Socket.all[0].closed).toBe(false);
    expect(current.status).toBe("live"); expect(current.identity?.authorId).toBe(authorId);
    expect(boundary.fetch.mock.calls.filter(([url]) => url === "/api/chat")).toHaveLength(1);
  });

  it("keeps the socket throughout a genuinely slow suspended transition", async () => {
    vi.useFakeTimers(); const wait = deferred(); pages["/FROG"].wait = wait.promise;
    await mount(); await act(() => Socket.all[0].open());
    await navigate("/FROG");
    await act(() => vi.advanceTimersByTimeAsync(65_000));
    expect(Socket.all).toHaveLength(1); expect(Socket.all[0].closed).toBe(false);
    await act(() => wait.resolve());
    expect(container.querySelector('[data-page="FROG"]')).toBeTruthy();
    expect(Socket.all).toHaveLength(1); expect(Socket.all[0].closed).toBe(false);
  });

  it("preserves mobile-open state, drafts, retry identity, cooldown and moderation across pages", async () => {
    boundary.desktop = false; await mount(); expect(Socket.all).toHaveLength(0);
    await act(() => current.setOpen(true)); await act(() => Socket.all[0].open());
    const memory = { draft: "Unsent $FROG", request: { text: "Unsent $FROG", address: "wallet-one", id: "request-12345" }, cooldownUntil: Date.now() + 3000, error: "Retry later" };
    await act(() => { current.rememberDraft("wallet-one", memory); current.setShowBanned(true); });
    await act(() => current.moderation.load());
    await navigate("/FROG");
    expect(current.open).toBe(true); expect(current.drafts["wallet-one"]).toEqual(memory);
    expect(current.showBanned).toBe(true); expect(current.moderation.bans).toHaveLength(1);
    expect(Socket.all).toHaveLength(1); expect(Socket.all[0].closed).toBe(false);
    await act(() => current.setOpen(false)); expect(Socket.all[0].closed).toBe(true);
    expect(current.drafts["wallet-one"]).toEqual(memory);
  });

  it("does not connect on initially refunded or non-chat pages", async () => {
    await mount("/DEAD"); expect(Socket.all).toHaveLength(0);
    await navigate("/dispense"); expect(Socket.all).toHaveLength(0);
  });

  it.each(["/DEAD", "/dispense", "/NOPE"])("closes after a committed ineligible destination %s", async (path) => {
    await mount(); await navigate(path);
    expect(Socket.all).toHaveLength(1); expect(Socket.all[0].closed).toBe(true);
    expect(current.status).toBe("offline");
  });

  it("keeps the original socket when a pending navigation is cancelled", async () => {
    const wait = deferred(); pages["/FROG"].wait = wait.promise;
    await mount(); await navigate("/FROG");
    await act(() => boundary.navigate("/PEPE")); await act(() => wait.resolve());
    expect(container.querySelector('[data-page="PEPE"]')).toBeTruthy();
    expect(Socket.all).toHaveLength(1); expect(Socket.all[0].closed).toBe(false);
  });

  it("closes when a pending asset navigation reaches an error boundary", async () => {
    const wait = deferred(); pages["/FROG"].wait = wait.promise;
    vi.spyOn(console, "error").mockImplementation(() => {});
    await mount(); await navigate("/FROG");
    await act(() => wait.reject(new Error("Page failed")));
    expect(container.textContent).toContain("Page failed");
    expect(Socket.all[0].closed).toBe(true); expect(current.status).toBe("offline");
  });

  it("closes on collapse during a slow navigation and does not reopen at its destination", async () => {
    const wait = deferred(); pages["/FROG"].wait = wait.promise;
    await mount(); await navigate("/FROG"); await act(() => current.setCollapsed(true));
    expect(Socket.all[0].closed).toBe(true);
    await act(() => wait.resolve()); expect(Socket.all).toHaveLength(1);
    await act(() => current.setCollapsed(false)); expect(Socket.all).toHaveLength(2);
  });

  it("keeps locale-aware asset links and closes when an eligible page becomes refunded", async () => {
    boundary.locale = "ja";
    pages["/ja/PEPE"] = { asset: "PEPE" }; pages["/ja/FROG"] = { asset: "FROG" };
    await mount("/ja/PEPE"); await navigate("/FROG");
    expect(boundary.router.push).toHaveBeenLastCalledWith("/ja/FROG");
    expect(Socket.all).toHaveLength(1); expect(Socket.all[0].closed).toBe(false);
    pages["/ja/FROG"].eligible = false;
    await act(() => root.render(<App initial="/ja/PEPE" />));
    expect(Socket.all[0].closed).toBe(true);
  });
});
