// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SWRConfig, useSWRConfig, type Cache } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AllLaunchesView } from "@/app/[lang]/all/_components/all-launches-view";
import type { HomeToolbar } from "@/app/[lang]/_components/home-toolbar";
import { LocaleProvider } from "@/lib/i18n/client";
import { splitLocale, type Locale } from "@/lib/i18n/locales";
import type { LaunchPage, SectionRow } from "@/lib/launch-row";
import type { Fairminter, LaunchPhase } from "@/lib/xcp69";

const boundary = vi.hoisted(() => ({
  query: "", pathname: "/graduated", phase: "graduated" as LaunchPhase, locale: "en" as Locale, replace: vi.fn(), push: vi.fn(),
  pages: vi.fn(), stats: vi.fn(), height: vi.fn(), marketPrices: vi.fn(), holders: vi.fn(), unexpectedFetch: vi.fn(),
  mints: [] as { asset: string }[], orders: [] as { asset: string }[],
}));
vi.mock("next/navigation", () => ({
  usePathname: () => boundary.pathname,
  useSearchParams: () => new URLSearchParams(boundary.query),
  useRouter: () => ({ replace: boundary.replace, push: boundary.push }),
}));
vi.mock("@/lib/all-launches", () => ({ ALL_LAUNCHES_PAGE_SIZE: 200, fetchAllLaunchesPage: boundary.pages }));
vi.mock("@/lib/api/launchpad-api", () => ({ fetchLaunchStats: boundary.stats }));
vi.mock("@/lib/api/counterparty", () => ({ fetchBlockHeight: boundary.height, fetchHolderCount: boundary.holders }));
vi.mock("@/lib/api/price", () => ({ fetchMarketPrices: boundary.marketPrices }));
vi.mock("@/hooks/use-mempool", () => ({ useMempool: () => ({ mints: boundary.mints, orders: boundary.orders }) }));
vi.mock("@/lib/wallet/wallet-context", () => ({ useWallet: () => ({ status: "disconnected" }) }));
vi.mock("@/lib/currency", () => ({ useFiat: () => (n: number) => `$${n}`, useFxRate: () => ({ code: "USD", rate: 1 }) }));
vi.mock("@/components/token-image", () => ({ TokenImage: () => null }));
vi.mock("@/components/lazy-link", () => ({ LazyLink: (props: ComponentProps<"a">) => <a {...props} /> }));
vi.mock("@/app/[lang]/_components/home-toolbar", () => ({
  HomeToolbar: ({ height, btcUsd, xcpUsd, btcChange30d, xcpChange30d }: ComponentProps<typeof HomeToolbar>) => (
    <div data-home-toolbar data-height={height} data-btc-usd={btcUsd} data-xcp-usd={xcpUsd}
      data-btc-change={btcChange30d} data-xcp-change={xcpChange30d}>
      <button type="button">Search launches</button><a href="/create">Create</a>
    </div>
  ),
}));
vi.mock("@/app/[lang]/graveyard/_components/graveyard-list", () => ({
  GraveyardCard: ({ row }: { row: SectionRow }) => <article data-asset={row.fm.asset}>{row.fm.asset}</article>,
}));

// The coordinator, SWR cache and tabs are real. Render controls are small DOM
// adapters so this suite tests data transitions rather than Radix menu events.
// Keep the production sort choices, including each phase's actual default.
vi.mock("@/app/[lang]/_components/launch-sections", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/[lang]/_components/launch-sections")>();
  return {
    ...actual,
    Card: ({ row, denomination, pending }: { row: SectionRow; denomination: string; pending: number }) => (
      <article data-asset={row.fm.asset} data-denomination={denomination} data-pending={pending}>{row.fm.asset}</article>
    ),
    LaunchTable: ({ rows, offset, denomination, countMode }: { rows: SectionRow[]; offset: number; denomination: string; countMode: string }) => (
      <table data-offset={offset} data-denomination={denomination} data-count-mode={countMode}><tbody>
        {rows.map((row, index) => <tr key={row.fm.tx_hash} data-asset={row.fm.asset}><td>{offset + index + 1}</td><td>{row.fm.asset}</td></tr>)}
      </tbody></table>
    ),
    SortMenu: ({ label, options, value, onChange }: ComponentProps<typeof actual.SortMenu>) => (
      <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
    ),
    ViewToggle: ({ value, onChange }: ComponentProps<typeof actual.ViewToggle>) => <div>
      <button aria-label="Grid view" aria-pressed={value === "grid"} onClick={() => onChange("grid")}>Grid</button>
      <button aria-label="Table view" aria-pressed={value === "table"} onClick={() => onChange("table")}>Table</button>
    </div>,
    DenominationToggle: ({ value, onChange }: ComponentProps<typeof actual.DenominationToggle>) => <div>
      <button aria-label="USD denomination" aria-pressed={value === "usd"} onClick={() => onChange("usd")}>USD</button>
      <button aria-label="XCP denomination" aria-pressed={value === "xcp"} onClick={() => onChange("xcp")}>XCP</button>
    </div>,
    TradingDataLink: () => <a data-trading-data href="https://opreturn.art/">Trading Data</a>,
    Pager: ({ page, pages, onGo }: ComponentProps<typeof actual.Pager>) => <nav aria-label="Launch pages">
      <output aria-label="Current page">{page + 1}/{pages}</output>
      <button disabled={page === 0} onClick={() => onGo(page - 1)}>Previous page</button>
      <button disabled={page === pages - 1} onClick={() => onGo(page + 1)}>Next page</button>
    </nav>,
  };
});

let root: Root;
let container: HTMLDivElement;
let cache: Cache;
let mutate: ReturnType<typeof useSWRConfig>["mutate"];
const provider = () => cache;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function CacheControls() { mutate = useSWRConfig().mutate; return null; }
function page(phase: LaunchPhase, index = 0, total = 450, prefix: string = phase): LaunchPage {
  const offset = index * 200;
  return {
    rows: Array.from({ length: Math.min(200, Math.max(0, total - offset)) }, (_, n): SectionRow => ({
      fm: {
        tx_hash: `${prefix}-${offset + n}`, tx_index: offset + n, asset: `${prefix}-${offset + n}`, asset_longname: null,
        source: "bc1qcreatoraddress0000000000000000000000000",
        paid_quantity: "100000000", soft_cap_deadline_block: 99900, end_block: 0,
      } as Fairminter,
      phase, conforming: true, marketCapXcp: 10, priceXcp: 1, minters: 2, holders: null,
      announceBlock: 99000, progress: 0.5, lastMintBlock: 99001, launchXcpUsd: 5,
      priceDayAgoXcp: 1, displayDescription: null, burnedQuantity: "0",
    })),
    total, king: null,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetAllMocks();
  boundary.query = ""; boundary.pathname = "/graduated"; boundary.phase = "graduated"; boundary.locale = "en";
  const updateLocation = (href: string) => {
    const url = new URL(href, "http://localhost");
    boundary.query = url.search.slice(1); boundary.pathname = url.pathname;
    const { path, locale } = splitLocale(url.pathname);
    boundary.locale = locale;
    boundary.phase = path === "/graveyard" ? "refunded" : path.slice(1) as LaunchPhase;
    root.render(viewTree());
  };
  boundary.replace.mockImplementation(updateLocation); boundary.push.mockImplementation(updateLocation);
  boundary.mints = []; boundary.orders = [];
  boundary.height.mockResolvedValue(100000);
  boundary.marketPrices.mockResolvedValue({ btc: 60000, xcp: 5, btcUsd30dAgo: 50000, xcpUsd30dAgo: 4, xcpUsdDayAgo: 4 });
  boundary.stats.mockResolvedValue({ counts: { graduated: 449, minting: 35, scheduled: 7, refunded: 81 } });
  boundary.unexpectedFetch.mockRejectedValue(new Error("Unexpected unmocked network request"));
  vi.stubGlobal("fetch", boundary.unexpectedFetch);
  boundary.pages.mockImplementation(async (phase: LaunchPhase, _sort: string, index: number) => page(phase, index));
  cache = new Map();
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount()); container.remove();
  vi.unstubAllGlobals();
  expect(boundary.unexpectedFetch).not.toHaveBeenCalled();
});

function viewTree() {
  return <SWRConfig value={{
    provider, shouldRetryOnError: false,
  }}><CacheControls /><LocaleProvider locale={boundary.locale} messages={{}}><AllLaunchesView phase={boundary.phase} /></LocaleProvider></SWRConfig>;
}
async function render() {
  await act(async () => { root.render(viewTree()); });
}
async function settle(assertion: () => void) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { assertion(); return; } catch (error) { lastError = error; }
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
  throw lastError;
}
async function navigate(phase: LaunchPhase) {
  boundary.phase = phase; boundary.pathname = phase === "refunded" ? "/graveyard" : `/${phase}`;
  boundary.query = ""; await render();
}
const assets = () => [...container.querySelectorAll<HTMLElement>("[data-asset]")].map((row) => row.dataset.asset);
const sortSelect = () => container.querySelector<HTMLSelectElement>("select")!;
const currentPage = () => container.querySelector('[aria-label="Current page"]')?.textContent;
const tableOffset = () => container.querySelector("table")?.getAttribute("data-offset");
const tab = (label: string) => [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find((node) => node.textContent?.startsWith(label))!;
async function click(label: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.getAttribute("aria-label") === label || node.textContent === label)!;
  expect(button).toBeTruthy(); expect(button.disabled).toBe(false);
  await act(() => button.click());
}
async function sort(value: string) {
  await act(() => { sortSelect().value = value; sortSelect().dispatchEvent(new Event("change", { bubbles: true })); });
}

describe("all-launches view coordination", () => {
  it("orders a complete graveyard phase locally while an older API still returns opening order", async () => {
    boundary.phase = "refunded";
    const complete = page("refunded", 0, 4);
    complete.rows.forEach((row, index) => {
      row.progress = [0.02, 0.7, 0.7, 0.4][index]!;
      row.minters = [2, 9, 3, 12][index]!;
      row.fm.soft_cap_deadline_block = 99900 - index * 100;
    });
    boundary.pages.mockResolvedValue(complete);
    await render(); await settle(() => expect(assets()).toEqual(["refunded-0", "refunded-1", "refunded-2", "refunded-3"]));
    await sort("progress"); await settle(() => expect(assets()).toEqual(["refunded-2", "refunded-1", "refunded-3", "refunded-0"]));
    await sort("minters"); await settle(() => expect(assets()).toEqual(["refunded-3", "refunded-1", "refunded-2", "refunded-0"]));
    expect(complete.rows.map((row) => row.fm.asset)).toEqual(["refunded-0", "refunded-1", "refunded-2", "refunded-3"]);
  });

  it("keeps server order on a partial graveyard page rather than pretending it is a global sort", async () => {
    boundary.phase = "refunded"; boundary.query = "sort=progress";
    const partial = page("refunded", 0, 201);
    partial.rows.forEach((row, index) => { row.progress = index / 1000; });
    boundary.pages.mockResolvedValue(partial);
    await render(); await settle(() => expect(assets()).toHaveLength(200));
    expect(assets()[0]).toBe("refunded-0"); expect(assets()[199]).toBe("refunded-199");
    expect(currentPage()).toBe("1/2");
  });

  it("shows the creator address beneath each graveyard table asset without another lookup", async () => {
    boundary.phase = "refunded"; boundary.query = "view=table";
    boundary.pages.mockResolvedValue(page("refunded", 0, 1));
    await render(); await settle(() => expect(container.querySelector("tbody tr")).toBeTruthy());
    const link = container.querySelector<HTMLAnchorElement>("tbody td a")!;
    expect(link.getAttribute("href")).toBe("/refunded-0");
    expect(link.textContent).toContain("refunded-0");
    expect(link.textContent).toContain("by bc1qcr…000000");
    expect(link.querySelector(".text-\\[11px\\]")?.className).toContain("block truncate");
    expect(boundary.pages).toHaveBeenCalledTimes(1);
  });

  it("fetches only the selected phase and does not enrich individual assets", async () => {
    await render();
    await settle(() => expect(assets()).toHaveLength(200));
    expect(boundary.pages.mock.calls).toEqual([["graduated", "mcap", 0, undefined]]);
    expect(boundary.marketPrices).toHaveBeenCalledTimes(1);
    expect(boundary.height).toHaveBeenCalledTimes(1);
    expect(boundary.holders).not.toHaveBeenCalled();
    expect(boundary.stats).toHaveBeenCalledTimes(1);
    expect(tab("Graduated").textContent).toContain("450");
    expect(tab("Minting").textContent).toContain("35");
    expect(tab("Scheduled").textContent).toContain("7");
    expect(tab("Graveyard").textContent).toContain("81");
    expect(container.querySelector("h1")?.textContent).toBe("Graduated");
    expect(container.querySelector("h1")?.classList.contains("sr-only")).toBe(true);
    const toolbar = container.querySelector<HTMLElement>("[data-home-toolbar]")!;
    expect(container.querySelectorAll("[data-home-toolbar]")).toHaveLength(1);
    expect(toolbar.querySelector("button")?.textContent).toBe("Search launches");
    expect(toolbar.querySelector("a")?.getAttribute("href")).toBe("/create");
    expect(toolbar.dataset.height).toBe("100000");
    expect(toolbar.dataset.btcUsd).toBe("60000"); expect(toolbar.dataset.xcpUsd).toBe("5");
    expect(Number(toolbar.dataset.btcChange)).toBeCloseTo(20);
    expect(Number(toolbar.dataset.xcpChange)).toBeCloseTo(25);
    expect(container.querySelector("[data-trading-data]")).toBeNull();
    expect(container.querySelector('[aria-label="USD denomination"], [aria-label="XCP denomination"]')).toBeNull();
  });

  it("retains the active page count when the shared aggregate refreshes", async () => {
    await render(); await settle(() => expect(assets()).toHaveLength(200));
    await act(async () => { await mutate("launch-counts", {
      graduated: 448, minting: 36, scheduled: 8, refunded: 82,
    }, { revalidate: false }); });
    expect(tab("Graduated").textContent).toContain("450");
    expect(tab("Minting").textContent).toContain("36");
    expect(tab("Scheduled").textContent).toContain("8");
    expect(tab("Graveyard").textContent).toContain("82");
    expect(boundary.pages).toHaveBeenCalledTimes(1);
  });

  it("keeps unknown inactive counts as dashes when the aggregate is unavailable", async () => {
    boundary.stats.mockResolvedValue(null);
    await render(); await settle(() => expect(assets()).toHaveLength(200));
    expect(tab("Graduated").textContent).toContain("450");
    expect(tab("Minting").textContent).toContain("—");
    expect(tab("Scheduled").textContent).toContain("—");
    expect(tab("Graveyard").textContent).toContain("—");
    expect(container.textContent).not.toContain("The service is busy or unavailable.");
    expect(boundary.pages).toHaveBeenCalledTimes(1);
  });

  it("takes the phase from its route prop rather than an obsolete phase query", async () => {
    boundary.query = "phase=minting";
    await render();
    await settle(() => expect(assets()[0]).toBe("graduated-0"));
    expect(boundary.pages).toHaveBeenCalledWith("graduated", "mcap", 0, undefined);
  });

  it.each([
    ["minting", "pace"], ["scheduled", "soonest"], ["refunded", "failed"],
  ] as const)("loads one shared toolbar price snapshot when opening %s directly", async (phase, sort) => {
    boundary.phase = phase;
    await render();
    await settle(() => expect(assets()[0]).toBe(`${phase}-0`));
    expect(boundary.pages.mock.calls).toEqual([[phase, sort, 0, sort === "pace" ? 100000 : undefined]]);
    expect(boundary.marketPrices).toHaveBeenCalledTimes(1);
    const toolbar = container.querySelector<HTMLElement>("[data-home-toolbar]")!;
    expect(toolbar.dataset.btcUsd).toBe("60000"); expect(toolbar.dataset.xcpUsd).toBe("5");
  });

  it("reuses the market snapshot across phase changes without refetching it for every listing", async () => {
    await render(); await settle(() => expect(assets()[0]).toBe("graduated-0"));
    await navigate("minting"); await settle(() => expect(assets()[0]).toBe("minting-0"));
    await navigate("scheduled"); await settle(() => expect(assets()[0]).toBe("scheduled-0"));
    expect(boundary.marketPrices).toHaveBeenCalledTimes(1);
    expect(boundary.pages).toHaveBeenCalledTimes(3);
  });

  it("pushes a clean localized phase route, preserving display choices and resetting the sort", async () => {
    boundary.query = "sort=newest&view=table&denomination=xcp"; boundary.pathname = "/ja/graduated"; boundary.locale = "ja";
    await render();
    await act(() => { tab("Minting").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })); });
    expect(boundary.push).toHaveBeenCalledWith("/ja/minting?view=table&denomination=xcp", { scroll: false });
    expect(boundary.replace).not.toHaveBeenCalled();
    await settle(() => expect(assets()[0]).toBe("minting-0"));
    expect(sortSelect().value).toBe("pace");
    expect(container.querySelector("table")?.getAttribute("data-denomination")).toBe("xcp");
  });

  it.each([
    ["Graduated", "graduated", "/graduated", "mcap"],
    ["Minting", "minting", "/minting", "pace"],
    ["Scheduled", "scheduled", "/scheduled", "soonest"],
    ["Graveyard", "refunded", "/graveyard", "failed"],
  ] as const)("opens the clean %s route from its tab", async (label, phase, path, defaultSort) => {
    boundary.phase = phase === "graduated" ? "scheduled" : "graduated";
    await render();
    await act(() => { tab(label).dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })); });
    expect(boundary.push).toHaveBeenCalledWith(path, { scroll: false });
    await settle(() => expect(assets()[0]).toBe(`${phase}-0`));
    expect(sortSelect().value).toBe(defaultSort);
  });

  it("uses valid linked sort, table and denomination before the first request", async () => {
    boundary.query = "sort=performance_24h&view=table&denomination=xcp";
    await render(); await settle(() => expect(assets()).toHaveLength(200));
    expect(boundary.pages.mock.calls).toEqual([["graduated", "performance_24h", 0, undefined]]);
    expect(sortSelect().value).toBe("performance_24h");
    expect(tableOffset()).toBe("0");
    expect(container.querySelector("table")?.getAttribute("data-denomination")).toBe("xcp");
    expect(boundary.replace).not.toHaveBeenCalled();
  });

  it.each([
    ["graduated", "pace", "mcap"],
    ["minting", "unsupported", "pace"],
    ["scheduled", "progress", "soonest"],
    ["refunded", "performance", "failed"],
  ] as const)("defaults invalid linked controls within %s", async (phase, invalidSort, defaultSort) => {
    boundary.phase = phase;
    boundary.query = `sort=${invalidSort}&view=unsupported&denomination=BTC`;
    await render(); await settle(() => expect(assets()).toHaveLength(200));
    expect(boundary.pages.mock.calls).toEqual([[phase, defaultSort, 0, defaultSort === "pace" ? 100000 : undefined]]);
    expect(sortSelect().value).toBe(defaultSort);
    expect(container.querySelector("table")).toBeNull();
    if (phase !== "refunded") expect(container.querySelector("article")?.getAttribute("data-denomination")).toBe("usd");
  });

  it("keeps each control change in the localized URL without resetting its other controls", async () => {
    boundary.locale = "zh-hk"; boundary.pathname = "/zh-hk/graduated";
    boundary.query = "denomination=xcp";
    await render(); await settle(() => expect(assets()).toHaveLength(200));
    await sort("newest"); await click("Table view");
    expect(boundary.replace).toHaveBeenLastCalledWith("/zh-hk/graduated?sort=newest&view=table&denomination=xcp", { scroll: false });
    expect(boundary.pages.mock.calls).toEqual([
      ["graduated", "mcap", 0, undefined], ["graduated", "newest", 0, undefined],
    ]);
    expect(boundary.push).not.toHaveBeenCalled();
  });

  it("reads browser-history control state and requests its new sort at page one only", async () => {
    await render(); await settle(() => expect(assets()).toHaveLength(200));
    await click("Next page"); await settle(() => expect(currentPage()).toBe("2/3"));
    boundary.query = "sort=newest&view=table&denomination=xcp";
    await render(); await settle(() => expect(currentPage()).toBe("1/3"));
    expect(boundary.pages.mock.calls).toEqual([
      ["graduated", "mcap", 0, undefined], ["graduated", "mcap", 1, undefined], ["graduated", "newest", 0, undefined],
    ]);
    expect(container.querySelector("table")?.getAttribute("data-denomination")).toBe("xcp");
    boundary.query = ""; await render();
    await settle(() => expect(sortSelect().value).toBe("mcap"));
    expect(container.querySelector("table")).toBeNull();
    expect(currentPage()).toBe("1/3");
    expect(boundary.pages).toHaveBeenCalledTimes(3);
  });

  it("requests page index one for page two and numbers its rows from 201", async () => {
    await render(); await settle(() => expect(assets()).toHaveLength(200));
    await click("Table view"); await click("Next page");
    await settle(() => expect(assets()[0]).toBe("graduated-200"));
    expect(boundary.pages).toHaveBeenLastCalledWith("graduated", "mcap", 1, undefined);
    expect(tableOffset()).toBe("200"); expect(currentPage()).toBe("2/3");
  });

  it("resets to page one when the sort changes", async () => {
    await render(); await settle(() => expect(assets()).toHaveLength(200));
    await click("Next page"); await settle(() => expect(currentPage()).toBe("2/3"));
    await sort("newest"); await settle(() => expect(currentPage()).toBe("1/3"));
    expect(boundary.pages).toHaveBeenLastCalledWith("graduated", "newest", 0, undefined);
  });

  it("resets phase-local page and sort on a phase change", async () => {
    await render(); await settle(() => expect(assets()).toHaveLength(200));
    await sort("newest"); await click("Next page");
    await settle(() => expect(currentPage()).toBe("2/3"));
    await navigate("scheduled"); await settle(() => expect(assets()[0]).toBe("scheduled-0"));
    expect(sortSelect().value).toBe("soonest");
    expect(boundary.pages).toHaveBeenLastCalledWith("scheduled", "soonest", 0, undefined);
    await navigate("graduated"); await settle(() => expect(assets()[0]).toBe("graduated-0"));
    expect(sortSelect().value).toBe("mcap"); expect(currentPage()).toBe("1/3");
  });

  it("changes view without refetching launch rows or losing the linked denomination", async () => {
    boundary.query = "denomination=xcp";
    await render(); await settle(() => expect(assets()).toHaveLength(200));
    const requests = boundary.pages.mock.calls.length;
    await click("Table view");
    expect(container.querySelector("table")?.getAttribute("data-denomination")).toBe("xcp");
    expect(container.querySelector("table")?.getAttribute("data-count-mode")).toBe("minters");
    await click("Grid view");
    expect(container.querySelector("article")?.getAttribute("data-denomination")).toBe("xcp");
    expect(boundary.pages).toHaveBeenCalledTimes(requests);
    expect(boundary.holders).not.toHaveBeenCalled();
  });

  it("shows loading rather than an empty phase before the first answer", async () => {
    const pending = deferred<LaunchPage>(); boundary.pages.mockReturnValue(pending.promise);
    await render();
    expect(container.textContent).toContain("Loading launches…");
    expect(container.textContent).not.toContain("No launches in this phase.");
    expect(assets()).toHaveLength(0);
    await act(() => pending.resolve(page("graduated", 0, 0)));
    await settle(() => expect(container.textContent).toContain("No launches in this phase."));
    expect(currentPage()).toBeUndefined();
  });

  it("retries a first-page error instead of presenting an empty result", async () => {
    boundary.pages.mockRejectedValueOnce(new Error("unavailable"));
    await render();
    await settle(() => expect(container.textContent).toContain("The service is busy or unavailable."));
    expect(container.textContent).not.toContain("No launches in this phase.");
    await click("Try again"); await settle(() => expect(assets()).toHaveLength(200));
    expect(boundary.pages).toHaveBeenCalledTimes(2);
  });

  it("retains the previous rows, row numbers and pager after a page-two failure", async () => {
    await render(); await settle(() => expect(assets()).toHaveLength(200));
    await click("Table view");
    boundary.pages.mockRejectedValueOnce(new Error("second page failed"));
    await click("Next page");
    await settle(() => expect(container.textContent).toContain("Showing the last version that loaded."));
    expect(assets()[0]).toBe("graduated-0"); expect(tableOffset()).toBe("0"); expect(currentPage()).toBe("1/3");
    await click("Try again"); await settle(() => expect(assets()[0]).toBe("graduated-200"));
    expect(tableOffset()).toBe("200"); expect(currentPage()).toBe("2/3");
  });

  it("keeps the old row numbering while page two is loading", async () => {
    await render(); await settle(() => expect(assets()).toHaveLength(200));
    await click("Table view");
    const pending = deferred<LaunchPage>(); boundary.pages.mockReturnValueOnce(pending.promise);
    await click("Next page");
    expect(assets()[0]).toBe("graduated-0"); expect(tableOffset()).toBe("0"); expect(currentPage()).toBe("1/3");
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    await act(() => pending.resolve(page("graduated", 1)));
    await settle(() => expect(tableOffset()).toBe("200"));
  });

  it("keeps the loaded sort label after a new-sort failure, then retries that sort", async () => {
    await render(); await settle(() => expect(assets()).toHaveLength(200));
    boundary.pages.mockRejectedValueOnce(new Error("sort failed"));
    await sort("newest");
    await settle(() => expect(container.textContent).toContain("Showing the last version that loaded."));
    expect(sortSelect().value).toBe("mcap");
    await click("Try again"); await settle(() => expect(sortSelect().value).toBe("newest"));
    expect(boundary.pages).toHaveBeenLastCalledWith("graduated", "newest", 0, undefined);
  });

  it("does not show a previous phase's rows when the next phase fails", async () => {
    await render(); await settle(() => expect(assets()).toHaveLength(200));
    boundary.pages.mockRejectedValueOnce(new Error("phase failed"));
    await navigate("scheduled");
    await settle(() => expect(container.textContent).toContain("The service is busy or unavailable."));
    expect(assets()).toHaveLength(0);
  });

  it("waits for a positive height before requesting Mint Pace", async () => {
    boundary.phase = "minting";
    const height = deferred<number>(); boundary.height.mockReturnValue(height.promise);
    await render();
    expect(boundary.pages).not.toHaveBeenCalled(); expect(container.textContent).toContain("Loading launches…");
    await act(() => height.resolve(100123));
    await settle(() => expect(assets()[0]).toBe("minting-0"));
    expect(boundary.pages.mock.calls).toEqual([["minting", "pace", 0, 100123]]);
  });

  it("retries the height dependency when Mint Pace cannot start", async () => {
    boundary.phase = "minting";
    boundary.height.mockRejectedValueOnce(new Error("height failed"));
    await render();
    await settle(() => expect(container.textContent).toContain("The service is busy or unavailable."));
    expect(boundary.pages).not.toHaveBeenCalled();
    await click("Try again");
    await settle(() => expect(assets()[0]).toBe("minting-0"));
    expect(boundary.height).toHaveBeenCalledTimes(2);
    expect(boundary.pages.mock.calls).toEqual([["minting", "pace", 0, 100000]]);
  });

  it("never requests pace with a zero height", async () => {
    boundary.phase = "minting"; boundary.height.mockResolvedValue(0);
    await render();
    await settle(() => expect(container.textContent).toContain("The service is busy or unavailable."));
    expect(boundary.pages).not.toHaveBeenCalled();
  });

  it("rekeys Mint Pace when the shared height advances", async () => {
    boundary.phase = "minting";
    await render(); await settle(() => expect(assets()).toHaveLength(200));
    await act(async () => { await mutate("chain-height", 100001, { revalidate: false }); });
    await settle(() => expect(boundary.pages).toHaveBeenLastCalledWith("minting", "pace", 0, 100001));
  });

  it("refreshes a tab count from cached data when returning to that phase", async () => {
    await render(); await settle(() => expect(tab("Graduated").textContent).toContain("450"));
    await navigate("scheduled"); await settle(() => expect(assets()[0]).toBe("scheduled-0"));
    await act(async () => { await mutate(["all-launches", "graduated", "mcap", 0, null], {
      ...page("graduated", 0, 451, "cached"), page: 0, sort: "mcap",
    }, { revalidate: false }); });
    await navigate("graduated");
    await settle(() => expect(assets()[0]).toBe("cached-0"));
    await settle(() => expect(tab("Graduated").textContent).toContain("451"));
  });

  it("clamps a page that disappears when the phase shrinks", async () => {
    await render(); await settle(() => expect(assets()).toHaveLength(200));
    await click("Table view"); await click("Next page"); await settle(() => expect(tableOffset()).toBe("200"));
    const replacement = deferred<LaunchPage>();
    boundary.pages.mockImplementation(async (phase: LaunchPhase, _sort: string, index: number) => index === 0 ? replacement.promise : page(phase, index, 1, "remaining"));
    await act(async () => { await mutate(["all-launches", "graduated", "mcap", 1, null]); });
    await settle(() => expect(boundary.pages).toHaveBeenLastCalledWith("graduated", "mcap", 0, undefined));
    expect(container.textContent).toContain("Loading launches…");
    expect(assets()).toHaveLength(0);
    expect(currentPage()).toBeUndefined();
    const calls = boundary.pages.mock.calls.length;
    await click("Grid view");
    expect(boundary.pages).toHaveBeenCalledTimes(calls);
    await act(() => replacement.resolve(page("graduated", 0, 1, "remaining")));
    await settle(() => expect(assets()[0]).toBe("remaining-0"));
    expect(assets()).toHaveLength(1);
    expect(boundary.pages).toHaveBeenLastCalledWith("graduated", "mcap", 0, undefined);
    expect(container.querySelector("table")).toBeNull(); expect(currentPage()).toBeUndefined();
    expect(tab("Graduated").textContent).toContain("1");
  });

  it("retries a failed clamp replacement without restoring the invalid cached page", async () => {
    await render(); await settle(() => expect(assets()).toHaveLength(200));
    await click("Next page"); await settle(() => expect(currentPage()).toBe("2/3"));
    boundary.pages.mockResolvedValueOnce(page("graduated", 1, 1))
      .mockRejectedValueOnce(new Error("replacement failed"));
    await act(async () => { await mutate(["all-launches", "graduated", "mcap", 1, null]); });
    await settle(() => expect(container.textContent).toContain("The service is busy or unavailable."));
    expect(assets()).toHaveLength(0);
    boundary.pages.mockResolvedValueOnce(page("graduated", 0, 1, "remaining"));
    await click("Try again"); await settle(() => expect(assets()).toEqual(["remaining-0"]));
    expect(boundary.pages).toHaveBeenLastCalledWith("graduated", "mcap", 0, undefined);
  });
});
