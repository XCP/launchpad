// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useChatAssetLinks } from "@/hooks/use-chat-assets";

const transport = vi.hoisted(() => ({ index: vi.fn() }));
vi.mock("@/lib/api/launchpad-api", () => ({ fetchSearchIndex: transport.index }));

const INDEX_KEY = "xcp69-pool-membership";
const rows = [{ asset: "PEPE", asset_longname: null }, { asset: "FEWGOODMAN", asset_longname: null }];
let root: Root;
let container: HTMLDivElement;
let cache: Map<string, unknown>;
let consumers: { text: string }[][];
let focus = () => {};
let reconnect = () => {};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Probe({ messages, index }: { messages: { text: string }[]; index: number }) {
  const links = useChatAssetLinks(messages);
  return <output data-probe={index}>{JSON.stringify([...links])}</output>;
}
async function flush() {
  await act(async () => {
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
  });
}
async function render() {
  await act(async () => {
    root.render(<SWRConfig value={{ provider: () => cache,
      initFocus: (callback) => { focus = callback; return () => { focus = () => {}; }; },
      initReconnect: (callback) => { reconnect = callback; return () => { reconnect = () => {}; }; },
    }}>
      {consumers.map((messages, index) => <Probe key={index} index={index} messages={messages} />)}
    </SWRConfig>);
  });
  await flush();
}
const value = (index = 0) => JSON.parse(container.querySelector(`[data-probe="${index}"]`)!.textContent!);

beforeEach(() => {
  vi.useFakeTimers();
  transport.index.mockReset().mockResolvedValue(rows);
  cache = new Map(); consumers = [[]];
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
});

describe("cached chat launch membership", () => {
  it("links XCP directly to dispense without consulting the launch index", async () => {
    consumers = [[{ text: "$XCP, ($xcp)." }]];
    await render();
    expect(value()).toEqual([["XCP", "/dispense"]]);
    expect(transport.index).not.toHaveBeenCalled();
    consumers = [[{ text: "$XCP $PEPE" }]];
    await render();
    expect(value()).toEqual([["XCP", "/dispense"], ["PEPE", "/PEPE"]]);
    expect(transport.index).toHaveBeenCalledTimes(1);
  });

  it("performs no lookup for plain messages, currency amounts, URLs or unsupported subassets", async () => {
    consumers = [[{ text: "hello $10 $BTC https://site.test/$PEPE $PARENT.child" }]];
    await render();
    expect(transport.index).not.toHaveBeenCalled(); expect(value()).toEqual([]);
    consumers = [[{ text: "$pepe is here" }]];
    await render();
    expect(transport.index).toHaveBeenCalledTimes(1); expect(value()).toEqual([["PEPE", "/PEPE"]]);
  });

  it("shares one in-flight index across consumers and many different tags", async () => {
    let resolve!: (value: typeof rows) => void;
    transport.index.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    consumers = [[{ text: "$PEPE $UNKNOWN" }], [{ text: "$FEWGOODMAN $PEPE" }]];
    await render();
    expect(transport.index).toHaveBeenCalledTimes(1); expect(value()).toEqual([]);
    await act(async () => resolve(rows)); await flush();
    expect(value()).toEqual([["PEPE", "/PEPE"]]);
    expect(value(1)).toEqual([["FEWGOODMAN", "/FEWGOODMAN"], ["PEPE", "/PEPE"]]);
  });

  it("reuses successful membership on new messages, focus, reconnect and elapsed time", async () => {
    consumers = [[{ text: "$PEPE" }]];
    await render();
    consumers = [[{ text: "$FEWGOODMAN $NOTINDB" }, { text: "$PEPE" }]];
    await render();
    await act(async () => {
      // Exercise SWR's actual focus/reconnect callbacks without passing a DOM
      // Event as a Node timer delay (the library's browser adapter does that).
      focus(); reconnect();
      vi.advanceTimersByTime(3_600_000);
    });
    await flush();
    expect(transport.index).toHaveBeenCalledTimes(1);
    expect(value()).toEqual([["FEWGOODMAN", "/FEWGOODMAN"], ["PEPE", "/PEPE"]]);
  });

  it("reuses the profile's existing index cache and retains it through chat remounts", async () => {
    cache.set(INDEX_KEY, { data: rows });
    consumers = [[{ text: "$PEPE" }]];
    await render();
    expect(value()).toEqual([["PEPE", "/PEPE"]]);
    await act(async () => root.unmount()); root = createRoot(container);
    consumers = [[{ text: "$FEWGOODMAN" }]];
    await render();
    expect(value()).toEqual([["FEWGOODMAN", "/FEWGOODMAN"]]);
    expect(transport.index).not.toHaveBeenCalled();
  });

  it("does not fetch again when tags disappear and later return", async () => {
    consumers = [[{ text: "$PEPE" }]];
    await render();
    consumers = [[{ text: "ordinary message" }]]; await render();
    expect(value()).toEqual([]);
    consumers = [[{ text: "$FEWGOODMAN" }]]; await render();
    expect(value()).toEqual([["FEWGOODMAN", "/FEWGOODMAN"]]);
    expect(transport.index).toHaveBeenCalledTimes(1);
  });

  it("leaves tags plain during an outage and retries only once without any fallback transport", async () => {
    transport.index.mockResolvedValue(null);
    const unexpectedFetch = vi.fn(() => { throw new Error("No fallback fetch is allowed"); });
    vi.stubGlobal("fetch", unexpectedFetch);
    consumers = [[{ text: "$PEPE" }]];
    await render();
    expect(value()).toEqual([]); expect(transport.index).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(61_000); }); await flush();
    expect(transport.index).toHaveBeenCalledTimes(2);
    consumers = [[{ text: "$FEWGOODMAN" }]]; await render();
    await act(async () => { vi.advanceTimersByTime(3_600_000); }); await flush();
    expect(value()).toEqual([]); expect(transport.index).toHaveBeenCalledTimes(2);
    expect(unexpectedFetch).not.toHaveBeenCalled();
  });

  it("can recover on the bounded retry and links only runtime-validated index rows", async () => {
    transport.index.mockResolvedValueOnce(null).mockResolvedValueOnce([
      ...rows, { asset: "//outside.test" }, { asset: "OTHER?next=outside" },
      { asset: "A95428956661682177", asset_longname: "PARENT.child" },
    ]);
    consumers = [[{ text: "$PEPE $OTHER $PARENT.child" }]];
    await render();
    await act(async () => { vi.advanceTimersByTime(61_000); }); await flush();
    expect(value()).toEqual([["PEPE", "/PEPE"]]);
    expect(transport.index).toHaveBeenCalledTimes(2);
  });
});
