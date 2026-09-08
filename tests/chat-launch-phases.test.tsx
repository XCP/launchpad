// @vitest-environment happy-dom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { LaunchView } from "@/app/[lang]/[asset]/_components/launch-view";
import { LocaleProvider } from "@/lib/i18n/client";
import type { Fairminter } from "@/lib/xcp69";
import type { PairActivity } from "@/lib/api/counterparty";
import type { ChartCandle } from "@/lib/api/launchpad-api";
import type { ChartResolution } from "@/lib/candles";
const boundary = vi.hoisted(() => ({ register: vi.fn() }));
vi.mock("@/providers/chat-context", () => ({ useChatRoute: boundary.register }));

vi.mock("@/components/chat-panel", () => ({ ChatPanel: () => <aside data-chat-fixture /> }));
vi.mock("@/components/lazy-link", () => ({ LazyLink: ({ children }: { children: ReactNode }) => <span>{children}</span> }));
vi.mock("@/lib/currency", () => ({ useFiat: () => (value: number) => `$${value}` }));
vi.mock("@/app/[lang]/[asset]/_components/launch-chrome", () => ({ AnnouncedAgo: () => null, ArtLightbox: () => null, BlockAgo: () => null, BlockMonthYear: () => null, ShareButton: () => null, StatusPill: () => null }));
vi.mock("@/app/[lang]/[asset]/_components/launch-metadata", () => ({ HostedDescription: () => null, HostedInscriptionChip: () => null, HostedSocials: () => null, InscriptionChip: () => null, LaunchDescription: () => null, isOurMetadata: () => false }));
vi.mock("@/app/[lang]/[asset]/_components/launch-stats", () => ({ DenomToggle: () => null, MintTargetStat: () => null, ParticipantsStat: () => null, RaisedStat: () => null, TermsStrip: () => null, TxFeesStat: () => null }));
vi.mock("@/app/[lang]/[asset]/_components/scheduled-pulse", () => ({ ScheduledPulse: ({ mintForm }: { mintForm: ReactNode }) => <div data-scheduled-fixture>{mintForm}</div> }));
vi.mock("@/components/address-hover-card", () => ({ AddressHoverCard: () => null, IssuerChips: () => null, IssuerLine: () => null }));
vi.mock("@/app/[lang]/[asset]/_components/launch-room", () => ({ LaunchRoomProvider: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("@/app/[lang]/[asset]/_components/activity-tabs", () => ({ ActivityTabs: () => null }));
vi.mock("@/app/[lang]/[asset]/_components/address-badges", () => ({ AddressBadges: () => null }));
vi.mock("@/hooks/use-address-collections", () => ({ useAddressCollections: () => ({}) }));
vi.mock("@/app/[lang]/[asset]/_components/asset-trade-surface", () => ({ AssetTradeSurface: () => null }));
vi.mock("@/app/[lang]/[asset]/_components/edit-panel", () => ({ EditPanel: () => null }));
vi.mock("@/app/[lang]/[asset]/_components/live-progress", () => ({ LiveProgress: () => <div data-live-progress-fixture /> }));
vi.mock("@/app/[lang]/[asset]/_components/mint-deadline", () => ({ MintDeadline: () => <div data-mint-deadline-fixture /> }));
vi.mock("@/app/[lang]/[asset]/_components/mint-panel", () => ({ MintPanel: () => <div data-mint-form-fixture /> }));
vi.mock("@/app/[lang]/[asset]/_components/pressure-panel", () => ({ PressurePanel: () => null }));
vi.mock("@/app/[lang]/[asset]/_components/price-chart", () => ({ PriceChart: () => null }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
describe("chat launch-phase integration", () => {
  it.each(["scheduled", "minting", "graduated", "refunded"] as const)("keeps the %s view in its intended chat layout", async (phase) => {
    const fm = {
      tx_hash: "tx", tx_index: 1, block_index: 99000, source: "issuer", asset: "CHATFIXTURE", asset_longname: null,
      description: "", price: "1000000", quantity_by_price: "100000000000", hard_cap: "10000000000000000",
      soft_cap: "6900000000000000", earned_quantity: "3450000000000000", paid_quantity: "34500000000",
      start_block: 99000, soft_cap_deadline_block: 100000, end_block: 0, burn_payment: false,
      max_mint_per_tx: "100000000000000", max_mint_per_address: "100000000000000", premint_quantity: "0",
      minted_asset_commission_int: "0", lock_description: true, lock_quantity: true, divisible: true,
      pool_quantity: "3100000000000000", lp_asset: null, status: "open",
    } satisfies Fairminter;
    const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
    try {
      await act(() => root.render(<LocaleProvider locale="en" messages={{}}><LaunchView
        asset="CHATFIXTURE" fm={fm} conforming phase={phase} blockHeight={99500} mints={[]} pool={null}
        candles={{ "1d": [] } as unknown as Record<ChartResolution, ChartCandle[]>}
        xcpUsd={5} launchXcpUsd={4} btcUsd={100000} feeSats={null} holderCount={0}
        poolVolume={{} as PairActivity} displayDescription={null} burnedQuantity="0"
      /></LocaleProvider>));
      const wrapper = container.querySelector("[data-launch-chat]");
      expect(boundary.register).toHaveBeenLastCalledWith("CHATFIXTURE", phase !== "refunded");
      expect(Boolean(wrapper)).toBe(phase !== "refunded");
      expect(container.querySelectorAll("[data-chat-fixture]")).toHaveLength(phase === "refunded" ? 0 : 1);
      if (wrapper) {
        expect(wrapper.children[0]!.className).toContain("min-w-0");
        expect(wrapper.children[1]!.matches("[data-chat-fixture]")).toBe(true);
      }
      if (phase === "minting" || phase === "scheduled") expect(container.querySelector("[data-mint-form-fixture]")).toBeTruthy();
      expect(Boolean(container.querySelector("[data-mint-deadline-fixture]"))).toBe(phase === "minting");
      expect(Boolean(container.querySelector("[data-live-progress-fixture]"))).toBe(phase === "minting");
    } finally { await act(() => root.unmount()); container.remove(); }
  });
});
