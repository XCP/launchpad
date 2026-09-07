import { beforeEach, describe, expect, it, vi } from "vitest";
import { LOCALES, LOCALE_INFO, localePath } from "@/lib/i18n/locales";
import { localeAlternates } from "@/lib/i18n/seo";

vi.mock("next/root-params", () => ({ lang: async () => "en" }));
vi.mock("@opennextjs/cloudflare", () => ({ getCloudflareContext: vi.fn() }));
vi.mock("@/app/[lang]/profile/_components/profile-view", () => ({ ProfileView: () => null }));
vi.mock("@/lib/api/launchpad-api", () => ({ fetchSearchIndex: vi.fn() }));

import { generateMetadata as createMetadata } from "@/app/[lang]/create/layout";
import { generateMetadata as profileMetadata } from "@/app/[lang]/profile/[address]/page";
import HomePage from "@/app/[lang]/home/page";
import LaunchesPage from "@/app/[lang]/launches/page";
import sitemap from "@/app/sitemap";
import { fetchSearchIndex } from "@/lib/api/launchpad-api";

const ADDRESS = "1CounterpartyXXXXXXXXXXXXXXXUWLpVr";

describe("localized page metadata", () => {
  it.each(LOCALES)("identifies the create page and address profile in %s", async (lang) => {
    const create = await createMetadata({ params: Promise.resolve({ lang }) });
    const profile = await profileMetadata({ params: Promise.resolve({ lang, address: ADDRESS }) });
    for (const [metadata, path] of [
      [create, "/create"],
      [profile, `/profile/${ADDRESS}`],
    ] as const) {
      expect(metadata.alternates?.canonical).toBe(localePath(lang, path));
      expect(metadata.alternates?.languages).toEqual({
        ...Object.fromEntries(LOCALES.map((locale) => [LOCALE_INFO[locale].tag, localePath(locale, path)])),
        "x-default": path,
      });
    }
  });

  it("uses the create page's translated copy in link previews", async () => {
    const metadata = await createMetadata({ params: Promise.resolve({ lang: "ja" }) });
    expect(metadata.title).toContain("ローンチ");
    expect(metadata.description).not.toContain("Name, image, description.");
  });

  it("does not advertise an invalid address as a canonical profile", async () => {
    await expect(profileMetadata({
      params: Promise.resolve({ lang: "ja", address: "invalid-address" }),
    })).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  });
});

describe("legacy profile redirects", () => {
  it.each(LOCALES)("keeps the %s locale for both old routes", async (lang) => {
    for (const page of [HomePage, LaunchesPage]) {
      await expect(page({ params: Promise.resolve({ lang }) })).rejects.toMatchObject({
        digest: `NEXT_REDIRECT;replace;${localePath(lang, "/profile")};307;`,
      });
    }
  });
});

describe("multilingual sitemap", () => {
  beforeEach(() => {
    vi.mocked(fetchSearchIndex).mockReset();
  });

  it("lists each language URL and gives it the same reciprocal alternatives as its page", async () => {
    vi.mocked(fetchSearchIndex).mockResolvedValue([{ asset: "PEPE" }] as Awaited<ReturnType<typeof fetchSearchIndex>>);
    const rows = await sitemap();
    const urls = new Set(rows.map((row) => row.url));
    expect(urls.size).toBe(rows.length);

    for (const path of ["/", "/create", "/PEPE"]) {
      for (const locale of LOCALES) {
        const localized = localePath(locale, path);
        const url = `https://xcp.fun${localized === "/" ? "" : localized}`;
        const row = rows.find((candidate) => candidate.url === url);
        expect(row, url).toBeDefined();
        const pageAlternates = localeAlternates(locale, path).languages!;
        expect(row!.alternates?.languages).toEqual(Object.fromEntries(
          Object.entries(pageAlternates).map(([tag, route]) => [tag, `https://xcp.fun${route === "/" ? "" : route}`]),
        ));
        for (const alternate of Object.values(row!.alternates!.languages!)) {
          expect(urls.has(String(alternate)), `missing sitemap URL ${alternate}`).toBe(true);
        }
      }
    }
  });

  it("keeps all static language versions when the asset index is unavailable", async () => {
    vi.mocked(fetchSearchIndex).mockRejectedValue(new Error("index unavailable"));
    const rows = await sitemap();
    for (const locale of LOCALES) {
      expect(rows.some((row) => row.url === `https://xcp.fun${localePath(locale, "/create")}`)).toBe(true);
    }
  });
});
