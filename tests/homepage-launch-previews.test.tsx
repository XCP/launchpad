// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Card, LaunchSections, LaunchTable, type Denomination, type InitialPages } from "@/app/[lang]/_components/launch-sections";
import type { IndexedLaunch, IndexedPage } from "@/lib/api/launchpad-api";
import { LocaleProvider } from "@/lib/i18n/client";
import type { Locale } from "@/lib/i18n/locales";
import { PER_PAGE, toSectionRow, type LaunchPage } from "@/lib/launch-row";
import { setNumberLocale } from "@/lib/number-preference";
import type { LaunchPhase } from "@/lib/xcp69";

const boundary = vi.hoisted(() => ({
  pages: vi.fn(), holders: vi.fn(), prefetch: vi.fn(), unexpectedFetch: vi.fn(),
  wallet: { status: "disconnected", address: null as string | null },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ prefetch: boundary.prefetch }) }));
vi.mock("next/link", () => ({
  default: ({ prefetch: _prefetch, ...props }: ComponentProps<"a"> & { prefetch?: boolean }) => <a {...props} />,
}));
vi.mock("@/lib/api/launchpad-api", () => ({ fetchLaunchPage: boundary.pages }));
vi.mock("@/lib/api/counterparty", () => ({ fetchHolderCount: boundary.holders }));
vi.mock("@/hooks/use-mempool", () => ({ useMempool: () => ({ mints: [], orders: [] }) }));
vi.mock("@/lib/wallet/wallet-context", () => ({ useWallet: () => boundary.wallet }));
vi.mock("@/lib/currency", () => ({ useFiat: () => (n: number) => `$${n}`, useFxRate: () => ({ code: "USD", rate: 1 }) }));
vi.mock("@/components/token-image", () => ({ TokenImage: ({ asset }: { asset: string }) => <span data-asset={asset} /> }));

// Real Section, SWR, LazyLink, sort/view controls and number preferences. Only
// transport, wallet and image boundaries are replaced; no live requests run.
let root: Root;
let container: HTMLDivElement;
let cache: Map<string, never>;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function indexedRow(phase: LaunchPhase, n: number): IndexedLaunch & { holders: number } {
  return {
    fm: {
      tx_hash: `${phase}-${n}`, tx_index: n, block_index: 99900, source: "source",
      asset: `${phase.toUpperCase()}${n}`, asset_longname: null, description: "",
      price: "1000000", quantity_by_price: "100000000000", hard_cap: "10000000000000000",
      soft_cap: "6900000000000000", earned_quantity: "3450000000000000",
      paid_quantity: "34500000000", soft_cap_deadline_block: 100900, start_block: 99900 + n,
      end_block: 0, burn_payment: false, max_mint_per_tx: "100000000000000",
      max_mint_per_address: "100000000000000", premint_quantity: "0",
      minted_asset_commission_int: "0", lock_description: true, lock_quantity: true,
      divisible: true, pool_quantity: "3100000000000000", lp_asset: null, status: "open",
    },
    phase, conforming: true, xcpDepth: 0n,
    poolXcpReserve: phase === "graduated" ? "69000000000" : null,
    poolTokenReserve: phase === "graduated" ? "3100000000000000" : null,
    announceBlock: 99800 + n, minters: 35, holders: 77, lastMintBlock: 99950,
    launchTime: null, launchXcpUsd: null, priceDayAgoXcp: null,
    displayDescription: null, burnedQuantity: "0",
  };
}
function apiPage(phase: LaunchPhase, total = 90, length = Math.min(total, PER_PAGE[phase])): IndexedPage {
  return { rows: Array.from({ length }, (_, n) => indexedRow(phase, n)), total, king: null };
}
function page(phase: LaunchPhase, total = 90, length = Math.min(total, PER_PAGE[phase])): LaunchPage {
  const result = apiPage(phase, total, length);
  return { ...result, rows: result.rows.map(toSectionRow), king: null };
}
function initial(): InitialPages {
  return { graduated: page("graduated", 1234), minting: page("minting", 5678), scheduled: page("scheduled", 9012) };
}
beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear(); setNumberLocale("auto");
  boundary.wallet = { status: "disconnected", address: null };
  boundary.pages.mockImplementation(async (phase: LaunchPhase) => apiPage(phase));
  boundary.unexpectedFetch.mockRejectedValue(new Error("Unexpected live request"));
  vi.stubGlobal("fetch", boundary.unexpectedFetch);
  cache = new Map();
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount()); container.remove();
  vi.unstubAllGlobals(); setNumberLocale("auto");
  expect(boundary.unexpectedFetch).not.toHaveBeenCalled();
  expect(boundary.holders).not.toHaveBeenCalled();
});
async function render(pages = initial(), paged = true, locale: Locale = "en", messages = {}) {
  await act(async () => root.render(
    <SWRConfig value={{ provider: () => cache, shouldRetryOnError: false }}>
      <LocaleProvider locale={locale} messages={messages}>
        <LaunchSections initial={pages} paged={paged} height={100000} xcpUsd={5} xcpUsdDayAgo={4} />
      </LocaleProvider>
    </SWRConfig>,
  ));
}
const sections = () => [...container.querySelectorAll("section")];
const links = () => sections().map((section) => section.lastElementChild!.querySelector<HTMLAnchorElement>("a")!);
const assets = (section: Element) => [...section.querySelectorAll<HTMLElement>("[data-asset]")].map((node) => node.dataset.asset);
async function click(button: HTMLElement) { expect(button).toBeTruthy(); await act(() => button.click()); }
async function sort(section: Element, label: string) {
  const trigger = section.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
  await act(() => trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" })));
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((node) => node.textContent?.trim() === label)!;
  await click(item);
}
async function settle(assertion: () => void) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { assertion(); return; } catch (error) { lastError = error; }
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
  throw lastError;
}

describe("homepage launch previews", () => {
  it("shows a limited first page and one bottom link with each full total, without pagination or mount reads", async () => {
    await render();
    expect(sections().map((section) => assets(section).length)).toEqual([12, 36, 12]);
    expect(links().map((link) => link.textContent)).toEqual(["View all(1,234)→", "View all(5,678)→", "View all(9,012)→"]);
    expect(links().map((link) => link.getAttribute("href"))).toEqual([
      "/graduated?sort=mcap", "/minting?sort=pace", "/scheduled?sort=soonest",
    ]);
    for (const section of sections()) {
      expect(section.firstElementChild!.querySelector('a[href^="/graduated"], a[href^="/minting"], a[href^="/scheduled"]')).toBeNull();
      expect(section.querySelector("nav")).toBeNull();
    }
    expect(boundary.pages).not.toHaveBeenCalled();
  });

  it("localizes both the link path and the total using the independent number preference", async () => {
    setNumberLocale("fr");
    await render(initial(), true, "es", { "View all": "Ver todo" });
    expect(links()[0]!.textContent).toBe(`Ver todo(${new Intl.NumberFormat("fr").format(1234)})→`);
    expect(links()[0]!.getAttribute("href")).toBe("/es/graduated?sort=mcap");
  });

  it("carries the shared view and denomination plus each sort into the full phase, only querying offset zero", async () => {
    await render();
    await click(container.querySelector<HTMLElement>('button[aria-label="Table view"]')!);
    const xcp = [...container.querySelectorAll<HTMLButtonElement>('div[role="group"] button')].find((button) => button.textContent === "XCP")!;
    await click(xcp);
    await sort(sections()[2]!, "Newest");
    await settle(() => expect(boundary.pages).toHaveBeenCalledTimes(1));
    expect(boundary.pages.mock.calls).toEqual([["scheduled", "newest", 12, 0, undefined, undefined]]);
    expect(links().map((link) => link.getAttribute("href"))).toEqual([
      "/graduated?sort=mcap&view=table&denomination=xcp",
      "/minting?sort=pace&view=table&denomination=xcp",
      "/scheduled?sort=newest&view=table&denomination=xcp",
    ]);
    expect(sections().every((section) => section.querySelector("table"))).toBe(true);
  });

  it("keeps the latest full phase total in View all when Hide minted produces an empty preview", async () => {
    boundary.wallet = { status: "connected", address: "wallet-address" };
    boundary.pages.mockImplementation(async (phase: LaunchPhase, _sort: string, _limit: number, _offset: number, address?: string) => apiPage(phase, address ? 0 : 90));
    await render();
    await sort(sections()[1]!, "Progress");
    await settle(() => expect(links()[1]!.textContent).toContain("(90)"));
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    await click(checkbox);
    await settle(() => expect(sections()[1]!.textContent).toContain("You’ve already minted every live launch."));
    expect(links()[1]!.textContent).toBe("View all(90)→");
    expect(links()[1]!.getAttribute("href")).toBe("/minting?sort=progress");
    expect(boundary.pages.mock.calls).toEqual([
      ["minting", "progress", 36, 0, undefined, undefined],
      ["minting", "progress", 36, 0, "wallet-address", undefined],
    ]);
    await click(checkbox);
    expect(sections()[1]!.querySelector("h2")!.textContent).toBe("Minting90");
    expect(links()[1]!.textContent).toBe("View all(90)→");
  });

  it.each(["disconnect", "change address"])("restores cached unfiltered rows and their count after wallet %s", async (action) => {
    boundary.wallet = { status: "connected", address: "wallet-address" };
    boundary.pages.mockImplementation(async (phase: LaunchPhase, _sort: string, _limit: number, _offset: number, address?: string) => apiPage(phase, address ? 0 : 90));
    await render();
    await sort(sections()[1]!, "Progress");
    await settle(() => expect(links()[1]!.textContent).toContain("(90)"));
    await click(container.querySelector<HTMLInputElement>('input[type="checkbox"]')!);
    await settle(() => expect(sections()[1]!.textContent).toContain("You’ve already minted every live launch."));
    boundary.wallet = action === "disconnect"
      ? { status: "disconnected", address: null }
      : { status: "connected", address: "another-wallet" };
    await render();
    expect(assets(sections()[1]!)).toHaveLength(36);
    expect(sections()[1]!.querySelector("h2")!.textContent).toBe("Minting90");
    expect(links()[1]!.textContent).toBe("View all(90)→");
    expect(container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked ?? false).toBe(false);
    expect(boundary.pages).toHaveBeenCalledTimes(2);
  });

  it("sorts and slices the complete fallback locally and preserves existing empty-section behavior", async () => {
    const pages = { graduated: page("graduated", 60, 60), minting: page("minting", 60, 60), scheduled: page("scheduled", 60, 60) };
    await render(pages, false);
    expect(sections().map((section) => assets(section).length)).toEqual([12, 36, 12]);
    await sort(sections()[2]!, "Newest");
    expect(assets(sections()[2]!)[0]).toBe("SCHEDULED59");
    expect(links().every((link) => link.textContent === "View all(60)→")).toBe(true);
    expect(boundary.pages).not.toHaveBeenCalled();
    await render({ graduated: page("graduated", 0), minting: page("minting", 0), scheduled: page("scheduled", 0) }, false);
    expect(sections()).toHaveLength(1);
    expect(sections()[0]!.textContent).toContain("No live launches.");
    expect(links()[0]!.textContent).toBe("View all(0)→");
  });

  it("retains the extra crowned minting card without making it part of the table ranking or total", async () => {
    const pages = initial();
    pages.minting.king = toSectionRow(indexedRow("minting", 999));
    await render(pages);
    expect(assets(sections()[1]!)).toHaveLength(37);
    expect(assets(sections()[1]!)[0]).toBe("MINTING999");
    expect(links()[1]!.textContent).toBe("View all(5,678)→");
    await click(container.querySelector<HTMLElement>('button[aria-label="Table view"]')!);
    expect(assets(sections()[1]!)).toHaveLength(36);
    expect(assets(sections()[1]!)).not.toContain("MINTING999");
    expect(boundary.pages).not.toHaveBeenCalled();
  });
});

async function renderHeightFixture(height: number, denomination: Denomination, pending = 0) {
  await act(async () => root.render(
    <LocaleProvider locale="en" messages={{}}>
      {(["graduated", "minting", "scheduled"] as const).map((phase) => {
        const row = toSectionRow(indexedRow(phase, 0));
        row.lastMintBlock = 99964;
        row.priceDayAgoXcp = 0.00001;
        row.launchXcpUsd = 4;
        if (phase === "scheduled") {
          row.fm.start_block = 100012; row.fm.soft_cap_deadline_block = 100060;
          row.announceBlock = 99990;
        }
        return <div key={phase} data-phase={phase}>
          <div data-card><Card row={row} height={height} xcpUsd={5} xcpUsdDayAgo={3}
            denomination={denomination} fresh={phase === "minting"} pending={pending} /></div>
          <LaunchTable rows={[row]} phase={phase} offset={0} height={height}
            xcpUsd={5} xcpUsdDayAgo={3} denomination={denomination} />
        </div>;
      })}
    </LocaleProvider>,
  ));
}
const fixturePhase = (phase: LaunchPhase) => container.querySelector(`[data-phase="${phase}"]`)!;
const cells = (phase: LaunchPhase) => [...fixturePhase(phase).querySelectorAll("tbody td")].map((node) => node.textContent);
const cardWhen = (phase: LaunchPhase) => fixturePhase(phase).querySelector('[data-card] a > .space-y-1 > div:first-child > span:last-child')!.textContent;

describe("launch cards and tables before the block height is known", () => {
  it.each(["usd", "xcp"] as const)("keeps market and launch data but withholds height-derived times and recent %s returns until height arrives", async (denomination) => {
    await renderHeightFixture(0, denomination);
    expect([cardWhen("graduated"), cardWhen("minting"), cardWhen("scheduled")]).toEqual(["—", "—", "—"]);
    expect(cells("scheduled").slice(1)).toEqual(["—", "—", "—"]);
    expect(cells("minting")[2]).toBe("—");
    expect(cells("minting")[5]).toBe("—");
    expect(cells("minting")[1]).toBe("50.0%");
    expect(cells("minting")[3]).toBe("345 XCP");
    expect(cells("graduated")[3]).toContain("%");
    expect(cells("graduated").slice(4, 6)).toEqual(["—", "—"]);
    const graduated = fixturePhase("graduated").querySelector("[data-card]")!;
    expect(graduated.textContent).not.toContain("24h");
    expect(graduated.querySelector('[title*="last 24 hours"], [title*="since the pool opened"]')).toBeNull();
    const crown = fixturePhase("minting").querySelector('[title^="Wearing the crown"]')!;
    expect(crown.textContent?.trim()).toBe("👑");
    expect(crown.getAttribute("title")).not.toContain(" ago");

    await renderHeightFixture(100000, denomination);
    expect(cardWhen("graduated")).toBe("6h ago");
    expect(cardWhen("minting")).toBe("6d left");
    expect(cardWhen("scheduled")).toBe("2h");
    expect(cells("scheduled").slice(1)).toEqual(["2h", "10h", "2h"]);
    expect(cells("minting")[2]).toBe("5.00");
    expect(cells("minting")[5]).toBe("6d");
    expect(cells("graduated")[4]).toMatch(/% 6h$/);
    expect(cells("graduated")[5]).toBe("6h");
    expect(fixturePhase("graduated").querySelector('[title*="last 6h, since the pool opened"]')).toBeTruthy();
    expect(fixturePhase("minting").querySelector('[title^="Wearing the crown"]')!.textContent).toContain("6h ago");
  });

  it("keeps a real pending mint's just-now crown independent of unavailable chain height", async () => {
    await renderHeightFixture(0, "xcp", 1);
    expect(fixturePhase("minting").querySelector('[title^="Wearing the crown"]')!.textContent).toContain("just now");
    expect(cardWhen("minting")).toBe("—");
  });
});
