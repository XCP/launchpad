// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionProvider, useSession } from "@/providers/session-context";

const wallet = vi.hoisted(() => ({
  address: "wallet-A" as string | null,
  readyState: "connected",
  proofStatus: "verified",
  connectionProof: null as null | { address: string; message: string; signature: string },
}));
vi.mock("@/lib/wallet/wallet-context", () => ({ useWallet: () => wallet }));

type Cookie = { address: string; expires_at: number };
type Deferred = { promise: Promise<void>; resolve: () => void };
const NOW = 1_800_000_000;
let cookie: Cookie | null;
let root: Root;
let container: HTMLDivElement;
let current: ReturnType<typeof useSession>;
let seen: (string | null)[];
let calls: string[];
let gates: { method: string; deferred: Deferred }[];
let allGates: Deferred[];
let nextResponse: { method: string; status: number; body: unknown } | null;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pause(method: string) {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  const deferred = { promise, resolve };
  gates.push({ method, deferred });
  allGates.push(deferred);
  return deferred;
}

function select(address: string | null, verified = true) {
  wallet.address = address;
  wallet.readyState = address ? "connected" : "disconnected";
  wallet.proofStatus = address && verified ? "verified" : "none";
  wallet.connectionProof = address && verified
    ? { address, message: `signed-proof-${address}`, signature: "signed" } : null;
}

function Probe() {
  current = useSession();
  seen.push(current.address);
  return <output data-status={current.status}>{current.address ?? "readonly"}</output>;
}
async function flush() {
  await act(async () => {
    for (let index = 0; index < 30; index += 1) await Promise.resolve();
  });
}
async function render(strict = false) {
  await act(async () => {
    const app = <SessionProvider><Probe /></SessionProvider>;
    root.render(strict ? <StrictMode>{app}</StrictMode> : app);
  });
  await flush();
}
async function release(gate: Deferred) {
  await act(async () => { gate.resolve(); });
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(NOW * 1000);
  select("wallet-A");
  cookie = null; seen = []; calls = []; gates = []; allGates = []; nextResponse = null;
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe("/api/session");
    const method = init?.method ?? "GET";
    const address = method === "POST" ? JSON.parse(init!.body as string).proof.address : undefined;
    calls.push(address ? `${method}:${address}` : method);
    const snapshot = cookie && { ...cookie };
    const gateIndex = gates.findIndex((gate) => gate.method === method);
    if (gateIndex !== -1) await gates.splice(gateIndex, 1)[0].deferred.promise;
    if (nextResponse?.method === method) {
      const response = nextResponse; nextResponse = null;
      return Response.json(response.body, { status: response.status });
    }
    if (method === "GET") return Response.json(snapshot ?? { address: null, expires_at: null });
    if (method === "DELETE") { cookie = null; return Response.json({ ok: true }); }
    if (method === "POST") {
      // Models the browser applying Set-Cookie as the response arrives, even
      // if the initiating React effect has already been cleaned up.
      cookie = { address, expires_at: Math.floor(Date.now() / 1000) + 604_800 };
      return Response.json(cookie);
    }
    throw new Error(`Unexpected method ${method}`);
  }));
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
    for (const gate of allGates) gate.resolve();
  });
  await flush();
  container.remove();
  vi.unstubAllGlobals(); vi.useRealTimers();
});

describe("wallet session reconciliation", () => {
  it("restores a valid matching cookie without reposting an old or unavailable connection proof", async () => {
    select("wallet-A", false);
    cookie = { address: "wallet-A", expires_at: NOW + 3600 };
    await render();
    expect(current.address).toBe("wallet-A");
    expect(current.expiresAt).toBe(NOW + 3600);
    expect(current.status).toBe("authenticated");
    expect(calls).toEqual(["GET"]);
  });

  it("keeps a restorable cookie during initial wallet detection", async () => {
    select(null); wallet.readyState = "detecting";
    cookie = { address: "wallet-A", expires_at: NOW + 3600 };
    await render();
    expect(calls).toEqual([]);
    select("wallet-A", false);
    await render();
    expect(current.address).toBe("wallet-A");
    expect(calls).toEqual(["GET"]);
  });

  it("clears a different cookie before exchanging the selected address's proof", async () => {
    cookie = { address: "wallet-B", expires_at: NOW + 3600 };
    await render();
    expect(calls).toEqual(["GET", "DELETE", "POST:wallet-A"]);
    expect(current.address).toBe("wallet-A");
    expect(cookie?.address).toBe("wallet-A");
    expect(seen).not.toContain("wallet-B");
  });

  it("cannot authenticate a mere connected address or a proof for another address", async () => {
    wallet.proofStatus = "unverified";
    await render();
    expect(current.status).toBe("unauthenticated");
    wallet.proofStatus = "verified";
    wallet.connectionProof = { address: "wallet-B", message: "proof-B", signature: "signed" };
    await render();
    expect(current.address).toBeNull();
    expect(calls).toEqual(["GET", "GET"]);
  });

  it("serializes an account switch behind an old in-flight POST and never exposes its identity", async () => {
    const oldPost = pause("POST");
    await render();
    expect(calls).toEqual(["GET", "POST:wallet-A"]);
    select("wallet-B"); await render();
    expect(current.address).toBeNull();
    expect(calls).toEqual(["GET", "POST:wallet-A"]);
    await release(oldPost);
    expect(calls).toEqual(["GET", "POST:wallet-A", "GET", "DELETE", "POST:wallet-B"]);
    expect(current.address).toBe("wallet-B");
    expect(cookie?.address).toBe("wallet-B");
    expect(seen).not.toContain("wallet-A");
  });

  it("deletes after a disconnected account's late POST, then cannot resurrect it without proof", async () => {
    const oldPost = pause("POST");
    await render();
    select(null); await render();
    expect(calls).toEqual(["GET", "POST:wallet-A"]);
    await release(oldPost);
    expect(calls).toEqual(["GET", "POST:wallet-A", "DELETE"]);
    expect(current.address).toBeNull(); expect(cookie).toBeNull();
    select("wallet-A", false); await render();
    expect(current.address).toBeNull();
    expect(current.status).toBe("unauthenticated");
    expect(seen).not.toContain("wallet-A");
  });

  it("waits for a delayed disconnect DELETE before creating the next session", async () => {
    await render();
    const disconnect = pause("DELETE");
    select(null); await render();
    select("wallet-B"); await render();
    expect(calls).toEqual(["GET", "POST:wallet-A", "DELETE"]);
    await release(disconnect);
    expect(cookie?.address).toBe("wallet-B");
    expect(current.address).toBe("wallet-B");
    expect(calls).toEqual(["GET", "POST:wallet-A", "DELETE", "GET", "POST:wallet-B"]);
  });

  it("retains an observed disconnect when the same wallet reconnects before its old POST finishes", async () => {
    const oldPost = pause("POST");
    await render();
    select(null); await render();
    select("wallet-A", false); await render();
    await release(oldPost);
    expect(calls).toEqual(["GET", "POST:wallet-A", "DELETE", "GET"]);
    expect(cookie).toBeNull();
    expect(current.address).toBeNull();
    expect(current.status).toBe("unauthenticated");
    expect(seen).not.toContain("wallet-A");
  });

  it("does not resurrect a previous result when switching away and back before reconciliation", async () => {
    await render();
    const lookup = pause("GET");
    select("wallet-B"); await render();
    const returnLookup = pause("GET");
    select("wallet-A", false); await render();
    expect(current.address).toBeNull();
    await release(lookup);
    expect(current.address).toBeNull();
    await release(returnLookup);
    // Only a completed fresh server lookup can restore A.
    expect(current.address).toBe("wallet-A");
    expect(calls).toEqual(["GET", "POST:wallet-A", "GET", "GET"]);
  });

  it("deduplicates StrictMode effects and retains ordering across provider remounts", async () => {
    const oldPost = pause("POST");
    await render(true);
    expect(calls).toEqual(["GET", "POST:wallet-A"]);
    await act(async () => { root.unmount(); });
    root = createRoot(container);
    select("wallet-B"); await render(true);
    expect(calls).toEqual(["GET", "POST:wallet-A"]);
    await release(oldPost);
    expect(calls).toEqual(["GET", "POST:wallet-A", "GET", "DELETE", "POST:wallet-B"]);
    expect(cookie?.address).toBe("wallet-B");
    expect(current.address).toBe("wallet-B");
  });

  it("expires the visible session exactly at its signed deadline without refreshing a stale proof", async () => {
    cookie = { address: "wallet-A", expires_at: NOW + 1 };
    await render();
    await act(async () => { vi.advanceTimersByTime(999); });
    expect(current.address).toBe("wallet-A");
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(current.address).toBeNull(); expect(current.expiresAt).toBeNull();
    expect(current.status).toBe("unauthenticated");
    expect(calls).toEqual(["GET"]);
  });

  it("rechecks expiry when a suspended browser tab returns", async () => {
    cookie = { address: "wallet-A", expires_at: NOW + 1 };
    await render();
    vi.setSystemTime((NOW + 2) * 1000);
    await act(async () => { window.dispatchEvent(new Event("focus")); });
    expect(current.address).toBeNull();
    expect(current.status).toBe("unauthenticated");
  });

  it.each([
    { address: "wallet-A", expires_at: NOW },
    { address: "wallet-A", expires_at: `${NOW + 100}` },
    { address: "wallet-A", expires_at: NOW + 1.5 },
    { address: "wallet-A" },
  ])("does not expose an invalid restoration response: %j", async (body) => {
    select("wallet-A", false);
    nextResponse = { method: "GET", status: 200, body };
    await render();
    expect(current.address).toBeNull();
    expect(current.status).toBe("unauthenticated");
  });

  it("separates retryable service failure from a refused proof and retries only explicitly", async () => {
    nextResponse = { method: "POST", status: 503, body: { error: "Sessions unavailable" } };
    await render();
    expect(current.status).toBe("unavailable"); expect(current.address).toBeNull();
    nextResponse = { method: "POST", status: 401, body: { error: "Proof expired" } };
    await act(async () => current.retry()); await flush();
    expect(current.status).toBe("unauthenticated"); expect(current.address).toBeNull();
    expect(calls).toEqual(["GET", "POST:wallet-A", "GET", "POST:wallet-A"]);
  });

  it("immediately invalidates a rejected session and does not automatically exchange that proof again", async () => {
    await render();
    const clearing = pause("DELETE");
    await act(async () => current.invalidate()); await flush();
    expect(current.address).toBeNull(); expect(current.status).toBe("unauthenticated");
    await render();
    expect(calls).toEqual(["GET", "POST:wallet-A", "DELETE"]);
    await release(clearing);
    expect(cookie).toBeNull(); expect(current.address).toBeNull();
    await act(async () => current.retry()); await flush();
    expect(current.address).toBe("wallet-A");
  });

  it("invalidation also defeats an in-flight POST without racing its cookie response", async () => {
    const pending = pause("POST");
    await render();
    await act(async () => current.invalidate()); await flush();
    expect(calls).toEqual(["GET", "POST:wallet-A"]);
    await release(pending);
    expect(calls).toEqual(["GET", "POST:wallet-A", "DELETE"]);
    expect(cookie).toBeNull(); expect(current.address).toBeNull();
    expect(seen).not.toContain("wallet-A");
  });
});
