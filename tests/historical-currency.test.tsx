// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { PriceChart } from "../apps/web/src/app/[lang]/[asset]/_components/price-chart";
import { setCurrency, useCurrency } from "../apps/web/src/lib/currency";
import { setNumberLocale } from "../apps/web/src/lib/number-preference";

vi.mock("swr", () => ({ default: () => ({ data: [{ day: "2026-09-06", usd: 2 }, { day: "2026-09-07", usd: 3 }] }) }));
vi.mock("@/lib/api/launchpad-api", () => ({ fetchFxRates: async () => ({ date: "2026-09-07", rates: { CNY: 7 } }) }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

it("keeps historical USD candles and labels separate from a current CNY preference", async () => {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const candles = [0, 1].map(offset => ({
    time: Date.parse(`2026-09-0${6 + offset}T12:00:00Z`) / 1000,
    open: 0.01, high: 0.02, low: 0.01, close: 0.02, volumeXcpRaw: "100000000", trades: 1, lastBlock: 965900 + offset,
  }));
  function Probe() {
    const currency = useCurrency();
    return <><output>{currency.code}</output><PriceChart asset="TOKEN" candles={{ "1h": candles, "1d": candles }} xcpUsd={3} /></>;
  }
  try {
    setCurrency("USD"); setNumberLocale("en");
    await act(() => root.render(<Probe />));
    const chart = () => container.querySelector("svg[role=img]")!;
    const path = () => Array.from(chart().querySelectorAll("path")).map(element => element.getAttribute("d"));
    const initialPath = path();
    const initialLabels = chart().textContent;
    await act(() => setCurrency("CNY"));
    expect(container.querySelector("output")!.textContent).toBe("CNY");
    expect(chart().getAttribute("aria-label")).toContain("against USD");
    expect(path()).toEqual(initialPath);
    expect(chart().textContent).toBe(initialLabels);
    expect(chart().textContent).not.toContain("CN¥");
    await act(() => setNumberLocale("fr"));
    expect(chart().getAttribute("aria-label")).toContain("against USD");
    expect(path()).toEqual(initialPath);
    expect(chart().textContent).toContain("$");
  } finally {
    await act(() => root.unmount()); container.remove(); setCurrency("USD"); setNumberLocale("auto");
  }
});
