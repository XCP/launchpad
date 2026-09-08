// @vitest-environment happy-dom
import { act, useState, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DropdownMenu as DM } from "radix-ui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AmountInput } from "@/components/amount-input";
import {
  CurrencySubmenu, CurrencySwitch, LanguageSubmenu, LanguageSwitch,
  LOCALE_PREF_KEY, rememberLocale,
} from "@/components/language-switch";
import { LocaleSuggest } from "@/components/locale-suggest";
import { SiteFooter } from "@/components/site-footer";
import { parseAmountRaw } from "@/lib/amount-draft";
import { CURRENCIES, currencyForLocale, setCurrency, useCurrency, type Currency } from "@/lib/currency";
import { LocaleProvider, useLocale } from "@/lib/i18n/client";
import { LOCALES, type Locale } from "@/lib/i18n/locales";
import { useNumbers } from "@/lib/i18n/numbers";
import { NUMBER_PREF_KEY, setNumberLocale } from "@/lib/number-preference";

const navigation = vi.hoisted(() => ({
  pathname: "/", query: "", segment: null as string | null,
  push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(),
}));

// Only the router boundary and FX transport are replaced. The controls,
// LazyLink click handlers, currency store, number store and amount input are real.
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.query),
  useSelectedLayoutSegment: () => navigation.segment,
  useRouter: () => navigation,
}));
vi.mock("next/link", () => ({
  default: ({ href, onClick, prefetch: _prefetch, ...props }: ComponentProps<"a"> & { prefetch?: boolean }) => (
    <a {...props} href={href} onClick={(event) => {
      onClick?.(event);
      if (!event.defaultPrevented) {
        event.preventDefault();
        navigation.push(href);
      }
    }} />
  ),
}));
vi.mock("@/lib/api/launchpad-api", () => ({
  fetchFxRates: async () => ({
    date: "2026-09-07", rates: { JPY: 150, CNY: 7, HKD: 7.8, KRW: 1300, BRL: 5, EUR: 0.9 },
  }),
}));

const CURRENCY_PREF_KEY = "xcpfun:currency:v1";
const EXPECTED: [Locale, Currency][] = [
  ["en", "USD"], ["ja", "JPY"], ["zh", "CNY"], ["zh-tw", "USD"],
  ["zh-hk", "HKD"], ["es", "USD"], ["ko", "KRW"], ["pt", "BRL"],
  ["fr", "EUR"], ["ru", "USD"], ["uk", "USD"],
];
let root: Root;
let container: HTMLDivElement;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
  const locale = useLocale();
  const currency = useCurrency();
  const numbers = useNumbers();
  const [draft, setDraft] = useState("100000000.00000001");
  return <div>
    <output data-probe="locale">{locale}</output>
    <output data-probe="currency" data-auto={String(currency.auto)}>{currency.code}</output>
    <output data-probe="formatted">{numbers.commasRaw(10000000000000001n)}</output>
    <AmountInput ariaLabel="Exact amount" value={draft} onChange={setDraft} />
    <output data-probe="raw">{parseAmountRaw(draft)?.toString() ?? "invalid"}</output>
  </div>;
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear(); sessionStorage.clear();
  setCurrency("USD"); setNumberLocale("auto");
  navigation.pathname = "/"; navigation.query = ""; navigation.segment = null;
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-US"]);
  vi.spyOn(navigator, "language", "get").mockReturnValue("en-US");
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  setCurrency("USD"); setNumberLocale("auto");
});

async function render(children: ReactNode = null, locale: Locale = "en") {
  await act(async () => {
    root.render(<LocaleProvider locale={locale} messages={{}} machine>
      <Probe />{children}
    </LocaleProvider>);
  });
}
const value = (name: string) => container.querySelector(`[data-probe="${name}"]`)!.textContent;
const menuItem = (text: string) => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')]
  .find((node) => node.textContent?.replace("✓", "").trim() === text)!;
async function openMenu(label: string) {
  const trigger = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  expect(trigger).toBeTruthy();
  await act(() => { trigger.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" })); });
}
async function click(element: HTMLElement) {
  expect(element).toBeTruthy();
  await act(() => { element.click(); });
}
async function select(element: HTMLSelectElement, next: string) {
  await act(() => { element.value = next; element.dispatchEvent(new Event("change", { bubbles: true })); });
}

describe("deliberate language selection", () => {
  it.each(EXPECTED)("selects the supported %s default %s over a prior explicit choice", async (locale, expected) => {
    expect(EXPECTED.map(([lang]) => lang)).toEqual([...LOCALES]);
    expect(currencyForLocale(locale)).toBe(expected);
    expect(CURRENCIES).toContain(expected);
    setCurrency(expected === "USD" ? "EUR" : "USD");
    await render();
    await act(() => rememberLocale(locale));
    expect(localStorage.getItem(LOCALE_PREF_KEY)).toBe(locale);
    expect(localStorage.getItem(CURRENCY_PREF_KEY)).toBe(expected);
    expect(value("currency")).toBe(expected);
    expect(container.querySelector('[data-probe="currency"]')!.getAttribute("data-auto")).toBe("false");
  });

  it("lets the real separate menus override currency, then reset it by selecting the same language again", async () => {
    const controls = <><LanguageSwitch includeCurrency={false} /><CurrencySwitch /></>;
    navigation.pathname = "/swap";
    await render(controls);
    await openMenu("Language");
    expect(document.querySelector('[role="menuitem"][aria-haspopup="menu"]')).toBeNull();
    const japanese = menuItem("日本語");
    expect(japanese.getAttribute("href")).toBe("/ja/swap");
    await click(japanese);
    expect(value("currency")).toBe("JPY");
    expect(navigation.push).toHaveBeenLastCalledWith("/ja/swap");

    // The router boundary supplies the destination locale; no selection handler runs during rendering.
    navigation.pathname = "/ja/swap";
    await render(controls, "ja");
    navigation.push.mockClear();
    await openMenu("Currency: JPY");
    await click(menuItem("USD"));
    expect(value("currency")).toBe("USD");
    expect(value("locale")).toBe("ja");
    expect(localStorage.getItem(LOCALE_PREF_KEY)).toBe("ja");
    expect(navigation.push).not.toHaveBeenCalled();

    await openMenu("Language");
    await click(menuItem("日本語"));
    expect(value("currency")).toBe("JPY");
    expect(localStorage.getItem(CURRENCY_PREF_KEY)).toBe("JPY");
  });

  it("keeps the language submenu functional in the phone menu", async () => {
    await render(<DM.Root defaultOpen><DM.Trigger>Phone menu</DM.Trigger><DM.Content>
      <LanguageSubmenu path="/limit" /><CurrencySubmenu overlap />
    </DM.Content></DM.Root>);
    const language = document.querySelector<HTMLElement>('[role="menuitem"][aria-label="Language"]')!;
    await act(() => { language.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
    const japanese = menuItem("日本語");
    expect(japanese.getAttribute("href")).toBe("/ja/limit");
    await click(japanese);
    expect(value("currency")).toBe("JPY");
    expect(localStorage.getItem(LOCALE_PREF_KEY)).toBe("ja");
  });

  it.each([
    ["/minting", "en", "/ja/minting?sort=pace&view=table"],
    ["/fr/scheduled", "fr", "/ja/scheduled?sort=pace&view=table"],
    ["/graduated", "en", "/ja/graduated?sort=pace&view=table"],
    ["/fr/graveyard", "fr", "/ja/graveyard?sort=pace&view=table"],
    ["/swap", "en", "/ja/swap"],
  ] as const)("preserves listing controls only for language links from %s", async (pathname, locale, href) => {
    navigation.pathname = pathname; navigation.query = "sort=pace&view=table";
    await render(<LanguageSwitch includeCurrency={false} />, locale);
    await openMenu("Language");
    const japanese = menuItem("日本語");
    expect(japanese.getAttribute("href")).toBe(href);
    await click(japanese);
    expect(navigation.push).toHaveBeenLastCalledWith(href);
    expect(localStorage.getItem(LOCALE_PREF_KEY)).toBe("ja");
    expect(value("currency")).toBe("JPY");
  });

  it("keeps the compact currency submenu independent of the selected language", async () => {
    rememberLocale("ja"); navigation.pathname = "/ja/limit";
    await render(<LanguageSwitch compact />, "ja");
    await openMenu("Language");
    const currency = document.querySelector<HTMLElement>('[role="menuitem"][aria-haspopup="menu"]')!;
    expect(currency.textContent).toContain("JPY");
    await act(() => { currency.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
    await click(menuItem("USD"));
    expect(value("currency")).toBe("USD");
    expect(value("locale")).toBe("ja");
    expect(localStorage.getItem(LOCALE_PREF_KEY)).toBe("ja");
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("uses the native footer language handler and leaves that language alone on a currency change", async () => {
    navigation.pathname = "/fr";
    await render(<SiteFooter />, "fr");
    const selects = container.querySelectorAll<HTMLSelectElement>("footer select");
    await select(selects[0], "ja");
    expect(navigation.push).toHaveBeenLastCalledWith("/ja");
    expect(value("currency")).toBe("JPY");
    expect(localStorage.getItem(LOCALE_PREF_KEY)).toBe("ja");
    navigation.pathname = "/ja";
    await render(<SiteFooter />, "ja");
    navigation.push.mockClear();
    await select(container.querySelectorAll<HTMLSelectElement>("footer select")[1], "USD");
    expect(value("currency")).toBe("USD");
    expect(value("locale")).toBe("ja");
    expect(localStorage.getItem(LOCALE_PREF_KEY)).toBe("ja");
    expect(navigation.push).not.toHaveBeenCalled();
  });

  it("resets currency when the footer English recovery link is deliberately chosen", async () => {
    setCurrency("JPY"); navigation.pathname = "/ja";
    await render(<SiteFooter />, "ja");
    const english = [...container.querySelectorAll<HTMLAnchorElement>("footer a")].find(node => node.textContent === "English")!;
    await click(english);
    expect(navigation.push).toHaveBeenLastCalledWith("/");
    expect(localStorage.getItem(LOCALE_PREF_KEY)).toBe("en");
    expect(value("currency")).toBe("USD");
  });

  it("resets currency when the browser-language suggestion is accepted", async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["ja-JP"]);
    setCurrency("EUR"); navigation.pathname = "/docs";
    await render(<LocaleSuggest />);
    // Invalidate only the banner's module cache between independent mounted fixtures.
    await act(() => window.dispatchEvent(new Event("xcpfun:locale-suggest")));
    const link = [...container.querySelectorAll<HTMLAnchorElement>("a")].find(node => node.textContent === "日本語で表示")!;
    expect(link.getAttribute("href")).toBe("/ja/docs");
    await click(link);
    expect(value("currency")).toBe("JPY");
    expect(localStorage.getItem(LOCALE_PREF_KEY)).toBe("ja");
    expect(navigation.push).toHaveBeenLastCalledWith("/ja/docs");
  });

  it("does not reset a later override on a saved-language homepage revisit or passive locale navigation", async () => {
    rememberLocale("ja"); setCurrency("USD");
    await render(<LocaleSuggest />);
    expect(navigation.replace).toHaveBeenCalledExactlyOnceWith("/ja");
    expect(value("currency")).toBe("USD");
    navigation.pathname = "/ja/docs";
    await render(<LocaleSuggest />, "ja");
    expect(value("currency")).toBe("USD");
    expect(localStorage.getItem(CURRENCY_PREF_KEY)).toBe("USD");
    expect(localStorage.getItem(LOCALE_PREF_KEY)).toBe("ja");
  });

  it("does not change language or currency when a suggestion is dismissed", async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["ja-JP"]);
    setCurrency("EUR"); navigation.pathname = "/docs";
    await render(<LocaleSuggest />);
    await act(() => window.dispatchEvent(new Event("xcpfun:locale-suggest")));
    await click([...container.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === "閉じる")!);
    expect(value("currency")).toBe("EUR");
    expect(localStorage.getItem(LOCALE_PREF_KEY)).toBeNull();
    expect(navigation.push).not.toHaveBeenCalled();
    expect(navigation.replace).not.toHaveBeenCalled();
  });
});

describe("explicit currency controls", () => {
  it.each(["graduated", "minting", "scheduled", "graveyard"])("shows the footer on %s and preserves its view during language changes", async (phase) => {
    navigation.segment = phase; navigation.pathname = `/fr/${phase}`; navigation.query = "view=table";
    await render(<SiteFooter />, "fr");
    expect(container.querySelector("footer")).not.toBeNull();
    const language = container.querySelector<HTMLSelectElement>("footer select")!;
    await select(language, "ja");
    expect(navigation.push).toHaveBeenLastCalledWith(`/ja/${phase}?view=table`);
    expect(value("currency")).toBe("JPY");
  });

  it("keeps listing controls in the footer's English recovery link", async () => {
    navigation.segment = "minting"; navigation.pathname = "/ja/minting"; navigation.query = "sort=progress&view=table";
    await render(<SiteFooter />, "ja");
    const english = [...container.querySelectorAll<HTMLAnchorElement>("footer a")].find(node => node.textContent === "English")!;
    expect(english.getAttribute("href")).toBe("/minting?sort=progress&view=table");
  });

  it.each(["create", "swap", "limit", "dispense", "mempool", "PEPEMEMECOIN"])("keeps the footer hidden on %s", async (page) => {
    navigation.segment = page; navigation.pathname = `/${page}`;
    await render(<SiteFooter />);
    expect(container.querySelector("footer")).toBeNull();
  });

  it.each([["en-US", "USD"], ["ja-JP", "JPY"]] as const)(
    "shows and checks the detected %s currency %s without offering Auto",
    async (browserLanguage, expected) => {
      vi.spyOn(navigator, "languages", "get").mockReturnValue([browserLanguage]);
      vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({ timeZone: "UTC" } as Intl.ResolvedDateTimeFormatOptions);
      setCurrency("auto");
      await render(<><CurrencySwitch /><SiteFooter /></>);
      expect(container.querySelector('[data-probe="currency"]')!.getAttribute("data-auto")).toBe("true");
      expect(value("currency")).toBe(expected);
      expect(localStorage.getItem(CURRENCY_PREF_KEY)).toBeNull();
      await openMenu(`Currency: ${expected}`);
      const menuItems = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
      expect(menuItems.map(node => node.textContent!.replace("✓", "").trim())).toEqual([...CURRENCIES]);
      expect(menuItems.filter(node => node.textContent!.includes("✓")).map(node => node.textContent!.replace("✓", "").trim())).toEqual([expected]);
      const selects = container.querySelectorAll<HTMLSelectElement>("footer select");
      expect(selects[1].value).toBe(expected);
      expect([...selects[1].options].map(option => option.value)).toEqual([...CURRENCIES]);
      // Number formatting retains its separate follow-language option.
      expect(selects[2].querySelector('option[value="auto"]')!.textContent).toBe("Follow language");
    },
  );
});

describe("selection safety", () => {
  it.each(["blocked", "quota-full"])("still applies the chosen currency in memory with %s storage", async (failure) => {
    const persistent = localStorage;
    const fail = () => { throw new Error("Storage unavailable"); };
    await render();
    vi.stubGlobal("localStorage", {
      getItem: failure === "blocked" ? fail : persistent.getItem.bind(persistent),
      setItem: fail, removeItem: fail,
    });
    await act(() => rememberLocale("ja"));
    expect(value("currency")).toBe("JPY");
    expect(persistent.getItem(CURRENCY_PREF_KEY)).toBe("USD");
  });

  it("preserves an explicit number format and exact input while language selection changes fiat", async () => {
    const controls = <LanguageSwitch includeCurrency={false} />;
    await render(controls);
    await act(() => setNumberLocale("fr"));
    const formatted = value("formatted");
    await openMenu("Language");
    await click(menuItem("日本語"));
    navigation.pathname = "/ja";
    await render(controls, "ja");
    expect(value("currency")).toBe("JPY");
    expect(localStorage.getItem(NUMBER_PREF_KEY)).toBe("fr");
    expect(value("formatted")).toBe(formatted);
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Exact amount"]')!.value).toBe("100000000.00000001");
    expect(value("raw")).toBe("10000000000000001");
    // This protects the presentation action; real route navigation can still remount forms.
  });
});
