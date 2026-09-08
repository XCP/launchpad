// @vitest-environment happy-dom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocaleProvider } from "../apps/web/src/lib/i18n/client";
import type { Locale } from "../apps/web/src/lib/i18n/locales";
import { useNumbers } from "../apps/web/src/lib/i18n/numbers";
import { NUMBER_PREF_KEY, setNumberLocale } from "../apps/web/src/lib/number-preference";
import { setCurrency, useCurrency, useFiat } from "../apps/web/src/lib/currency";
import { AmountInput } from "../apps/web/src/components/amount-input";
import { ComposeError } from "../apps/web/src/components/compose-error";
import { parseAmountRaw } from "../apps/web/src/lib/amount-draft";
import es from "../apps/web/src/locales/es.json";
import ja from "../apps/web/src/locales/ja.json";

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/api/launchpad-api", () => ({ fetchFxRates: async () => ({ date: "2026-09-07", rates: { JPY: 150 } }) }));
let root: Root;
let container: HTMLDivElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
function Probe() {
  const [draft, setDraft] = useState("100000000.00000001");
  const numbers = useNumbers(); const currency = useCurrency(); const fiat = useFiat();
  return <><AmountInput value={draft} onChange={setDraft} /><output>{parseAmountRaw(draft)?.toString()}</output>
    <span id="number">{numbers.commasRaw(10000000000000001n)}</span>
    <span id="currency">{currency.code}</span><span id="fiat">{fiat(1.5)}</span>
    <ComposeError error="Raw amount could not be represented" errorCode="amount_precision" errorDetails={{ diagnostic: "Original API diagnostic", walletCode: 123 }} />
  </>;
}
async function render(locale: Locale) {
  await act(() => root.render(<LocaleProvider locale={locale} messages={locale === "es" ? es : ja}><Probe /></LocaleProvider>));
}
beforeEach(() => {
  localStorage.clear(); setNumberLocale("auto"); setCurrency("USD");
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(() => root.unmount()); container.remove(); });

it("keeps exact intent and USD during passive locale rendering and display-format changes", async () => {
  await render("ja");
  expect(container.querySelector("#number")!.textContent).toBe("100,000,000.00000001");
  await act(() => setNumberLocale("fr"));
  expect(container.querySelector("#number")!.textContent).toContain(",00000001");
  await render("es");
  expect(container.querySelector("#number")!.textContent).toContain(",00000001");
  expect(container.querySelector("#currency")!.textContent).toBe("USD");
  for (const locale of ["de-DE", "es-VE"] as const) {
    await act(() => setNumberLocale(locale));
    expect(container.querySelector("#number")!.textContent).toBe("100.000.000,00000001");
    expect(container.querySelector("input")!.value).toBe("100000000.00000001");
    expect(container.querySelector("output")!.textContent).toBe("10000000000000001");
  }
  await act(() => setNumberLocale("fr"));
  expect(container.querySelector("#fiat")!.textContent).toContain("1,50");
  expect(container.querySelector("input")!.value).toBe("100000000.00000001");
  expect(container.querySelector("output")!.textContent).toBe("10000000000000001");
  expect(localStorage.getItem(NUMBER_PREF_KEY)).toBe("fr");
  await act(() => setNumberLocale("es-ES"));
  expect(container.querySelector("#number")!.textContent).toBe("100.000.000,00000001");
  expect(container.querySelector("input")!.value).toBe("100000000.00000001");
  expect(container.querySelector("#currency")!.textContent).toBe("USD");
  await act(() => setNumberLocale("auto"));
  expect(container.querySelector("#number")!.textContent).toBe("100,000,000.00000001");
});

it("responds to another tab and safely falls back from a malformed saved choice", async () => {
  await render("ja");
  await act(() => { localStorage.setItem(NUMBER_PREF_KEY, "fr"); window.dispatchEvent(new StorageEvent("storage", { key: NUMBER_PREF_KEY })); });
  expect(container.querySelector("#number")!.textContent).toContain(",00000001");
  await act(() => { localStorage.setItem(NUMBER_PREF_KEY, "invalid"); window.dispatchEvent(new StorageEvent("storage", { key: NUMBER_PREF_KEY })); });
  expect(container.querySelector("#number")!.textContent).toBe("100,000,000.00000001");
});

it("translates actionable errors while preserving copyable codes and original diagnostics", async () => {
  await render("es");
  expect(container.textContent).toContain("Revisa la cantidad, las unidades y los decimales.");
  expect(container.querySelector("pre")!.textContent).toContain('"code": "amount_precision"');
  expect(container.querySelector("pre")!.textContent).toContain("Original API diagnostic");
  await render("ja");
  expect(container.textContent).toContain("数量、単位、小数点以下の桁数を確認してください。");
  expect(container.querySelector("pre")!.textContent).toContain('"walletCode": 123');
});
