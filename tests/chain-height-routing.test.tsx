// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SWRConfig, useSWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChainHeight } from "@/hooks/use-chain-height";

const STATUS = "https://api.xcp.io/v2/status";
const LIVE = "https://api.counterparty.io:4000/v2/";
const READ = "https://api.xcp.fun/node/v2/";
let root: Root;
let container: HTMLDivElement;
let cache: Map<string, never>;
let mutate: ReturnType<typeof useSWRConfig>["mutate"];
let http: ReturnType<typeof vi.fn>;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Exercise the real hook and both real HTTP readers, including the live SDK
// relay. Only HTTP is mocked; no node or wallet is contacted.
function Clock({ target, initial }: { target: number; initial: number }) {
  mutate = useSWRConfig().mutate;
  const height = useChainHeight(target, initial);
  return <output>{height}</output>;
}

beforeEach(() => {
  vi.useFakeTimers();
  cache = new Map();
  http = vi.fn();
  vi.stubGlobal("fetch", http);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function render(target: number, initial: number) {
  await act(async () => {
    root.render(<SWRConfig value={{ provider: () => cache, dedupingInterval: 0, shouldRetryOnError: false }}>
      <Clock target={target} initial={initial} />
    </SWRConfig>);
  });
  // SWR defers mount revalidation to the next frame when fallbackData exists.
  await act(() => vi.advanceTimersByTimeAsync(20));
}
const urls = () => http.mock.calls.map(([input]) => input instanceof Request ? input.url : String(input));

describe("shared chain clock routing", () => {
  it("uses indexed parsed height at distance, then direct parsed height on the next near-target refresh", async () => {
    http.mockImplementation(async (input) => {
      const url = String(input);
      if (url === STATUS) return Response.json({ result: { indexed_block: 997, tip: 1_010 } });
      if (url === LIVE) return Response.json({ result: { counterparty_height: 998, backend_height: 1_010 } });
      throw new Error(`Unexpected request: ${url}`);
    });
    await render(1_000, 990);
    expect(container.textContent).toBe("997");
    expect(urls()).toEqual([STATUS]);
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(container.textContent).toBe("998");
    expect(urls()).toEqual([STATUS, LIVE]);
  });

  it("keeps the three-minute indexed cadence while more than three blocks away", async () => {
    http.mockImplementation(async () => Response.json({ result: { indexed_block: 995 } }));
    await render(1_000, 990);
    await act(() => vi.advanceTimersByTimeAsync(179_000));
    expect(urls()).toEqual([STATUS]);
    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(urls()).toEqual([STATUS, STATUS]);
    expect(container.textContent).toBe("995");
  });

  it("does not fetch for a disabled target", async () => {
    await render(0, 990);
    await act(() => vi.advanceTimersByTimeAsync(600_000));
    expect(http).not.toHaveBeenCalled();
    expect(container.textContent).toBe("990");
  });

  it.each([null, 0, -1, 1.5, "9007199254740993"])("retains known height when a live response contains invalid height %s", async invalid => {
    http.mockImplementation(async () => Response.json({ result: { counterparty_height: 998 } }));
    await render(1_000, 997);
    expect(container.textContent).toBe("998");
    http.mockImplementation(async () => Response.json({ result: { counterparty_height: invalid } }));
    await act(async () => { await mutate("cp-height"); });
    expect(container.textContent).toBe("998");
    expect(urls()).toEqual([LIVE, LIVE]);
  });

  it("keeps fallback height through live and relay failures and recovers on a successful read", async () => {
    http.mockImplementation(async () => new Response("unavailable", { status: 503 }));
    await render(1_000, 997);
    expect(container.textContent).toBe("997");
    expect(urls()).toEqual([LIVE, "/api/cp/v2/"]);
    http.mockImplementation(async () => Response.json({ result: { counterparty_height: 999 } }));
    await act(async () => { await mutate("cp-height"); });
    expect(container.textContent).toBe("999");
    expect(urls()).toEqual([LIVE, "/api/cp/v2/", LIVE]);
  });

  it("does not invent a height when both indexed status and its protocol fallback are invalid", async () => {
    http.mockImplementation(async (input) => String(input) === STATUS
      ? Response.json({ result: { indexed_block: null, tip: 1_010 } })
      : Response.json({ result: { counterparty_height: 0 } }));
    await render(1_000, 0);
    expect(container.textContent).toBe("0");
    expect(urls()).toEqual([STATUS, READ]);
  });
});
