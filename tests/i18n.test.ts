import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOCALE,
  isLocale,
  isUnlocalizedPath,
  localePath,
  splitLocale,
} from "../apps/web/src/lib/i18n/locales";
import { makeT, messageKey } from "../apps/web/src/lib/i18n/t";

describe("t", () => {
  const t = makeT({
    "Market cap": "時価総額",
    "{n} minters": "{n}人のミンター",
    "All@@window": "全期間",
  });

  it("translates by English key and falls back to the English itself", () => {
    expect(t("Market cap")).toBe("時価総額");
    expect(t("Holders")).toBe("Holders");
  });

  it("interpolates named values in either language", () => {
    expect(t("{n} minters", { n: "1,234" })).toBe("1,234人のミンター");
    expect(makeT({})("{n} minters", { n: 5 })).toBe("5 minters");
  });

  it("leaves an unknown placeholder visible rather than blank", () => {
    expect(makeT({})("{n} of {total}", { n: 1 })).toBe("1 of {total}");
  });

  it("keys a context-qualified string separately from the bare one", () => {
    expect(messageKey("All", "window")).toBe("All@@window");
    expect(t("All", "window")).toBe("全期間");
    expect(t("All")).toBe("All");
  });
});

describe("locale paths", () => {
  it("recognises only exact lowercase locale codes", () => {
    expect(isLocale("ja")).toBe(true);
    expect(isLocale("JA")).toBe(false);
    expect(isLocale("jp")).toBe(false);
  });

  it("splits a prefixed path and leaves English paths alone", () => {
    expect(splitLocale("/ja/faq")).toEqual({ locale: "ja", path: "/faq" });
    expect(splitLocale("/ja")).toEqual({ locale: "ja", path: "/" });
    expect(splitLocale("/faq")).toEqual({ locale: DEFAULT_LOCALE, path: "/faq" });
    expect(splitLocale("/")).toEqual({ locale: DEFAULT_LOCALE, path: "/" });
    // An asset called JA is an asset: names are uppercase, codes are not.
    expect(splitLocale("/JA")).toEqual({ locale: DEFAULT_LOCALE, path: "/JA" });
  });

  it("builds the same path under another locale without a trailing slash", () => {
    expect(localePath("ja", "/faq")).toBe("/ja/faq");
    expect(localePath("ja", "/")).toBe("/ja");
    expect(localePath("en", "/faq")).toBe("/faq");
    expect(localePath("ja", "CAPTAINDAN")).toBe("/ja/CAPTAINDAN");
  });

  it("never prefixes route handlers, generated files or assets", () => {
    for (const p of ["/i/PEPE", "/j/PEPE.json", "/api/price", "/full/PEPE", "/art/PEPE", "/icon/PEPE", "/_next/static/x.js", "/sitemap.xml", "/PEPE.json"]) {
      expect(isUnlocalizedPath(p), p).toBe(true);
    }
    for (const p of ["/", "/faq", "/PEPE", "/ja/PEPE", "/profile/1abc"]) {
      expect(isUnlocalizedPath(p), p).toBe(false);
    }
  });
});
