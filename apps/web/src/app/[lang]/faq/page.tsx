import type { Metadata } from "next";
import { isLocale } from "@/lib/i18n/locales";
import { rich } from "@/lib/i18n/rich";
import { localeAlternates } from "@/lib/i18n/seo";
import { getMessages, getT } from "@/lib/i18n/server";
import { makeT, msg } from "@/lib/i18n/t";
import { LazyLink } from "@/components/lazy-link";
import { LaunchStory } from "@/components/launch-story";
import { fetchXcpUsd } from "@/lib/api/price";
import { XCP69_OPENING_MULTIPLE } from "@/lib/xcp69";
import { PoolPlayground } from "@/app/[lang]/faq/_components/explainer";

const PAGE_METADATA = {
  title: msg("How it works — xcp.fun"),
  description:
    msg("One fixed parameter set for token launches on Counterparty: the launch sells out and liquidity locks forever, or everyone is refunded. Zero creator take, enforced by consensus."),
};

/** The page's own metadata, plus the hreflang set for the locale it is
 *  rendered under — see lib/i18n/seo. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  const locale = isLocale(lang) ? lang : "en";
  const t = makeT(await getMessages(locale));
  return {
    ...PAGE_METADATA,
    title: t(String(PAGE_METADATA.title)),
    ...(PAGE_METADATA.description ? { description: t(PAGE_METADATA.description) } : {}),
    alternates: localeAlternates(locale, "/faq"),
  };
}

/** Label and value are both translated at render; a value that is only a
 *  number is left as it is. */
const PARAMS: [string, string][] = [
  [msg("Supply"), msg("100,000,000 — locked at close")],
  [msg("Public sale"), msg("69,000,000 (the soft cap IS the whole sale)")],
  [msg("Pool reserve"), "31,000,000"],
  [msg("Price"), msg("0.01 XCP per 1,000-token lot")],
  [msg("Per-address cap"), msg("1,000,000 tokens (10 XCP)")],
  [msg("Start"), msg("a future block — announced on-chain before minting can open")],
  [msg("Mint window"), msg("exactly 1,000 blocks (~7 days) from start")],
  [msg("Premine / commission"), msg("none — the creator mints like everyone else")],
  [msg("Asset"), msg("named assets only, divisible")],
];

export default async function StandardPage() {
  const t = await getT();
  const xcpUsd = await fetchXcpUsd();
  const mult = XCP69_OPENING_MULTIPLE.toFixed(2);
  const linkClass = "text-purple-600 dark:text-purple-400 underline";
  return (
    <article className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-3xl font-bold">{t("From fair mint to open market.")}</h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          {t("Announced before minting. The same price for everyone. Fill the mint to open a trading pool, or get your XCP back.")}
        </p>
      </div>

      <LaunchStory />

      <section id="launch-terms" className="scroll-mt-24 rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h2 className="font-bold">{t("The XCP-69 standard")}</h2>
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {t("guaranteed by consensus, not this website")}
          </span>
        </div>
        <dl className="mt-3 divide-y divide-gray-100 text-sm dark:divide-gray-800">
          {PARAMS.map(([k, v]) => (
            <div key={k} className="grid gap-1 py-2.5 sm:grid-cols-[1fr_1.6fr] sm:gap-4">
              <dt className="text-gray-500 dark:text-gray-400">{t(k)}</dt>
              <dd className="font-medium sm:text-right">{t(v)}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          {t("Every launch follows these terms, checked against its on-chain record.")}
        </p>
      </section>

      <section id="launch-pool" className="scroll-mt-24">
        <h2 className="mb-3 font-bold">{t("What locked liquidity means")}</h2>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
          {t("After a successful launch, nobody can withdraw the initial LP position. Trading still moves XCP and tokens through the pool. Try buying or selling below.")}
        </p>
        <PoolPlayground xcpUsd={xcpUsd} />
      </section>

      <section>
        <h2 className="mb-2 font-bold">{t("FAQ")}</h2>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
          {t("The honest questions — including the ones that don't flatter us.")}
        </p>
        <div className="divide-y divide-gray-100 dark:divide-gray-800 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
          <details className="p-4">
            <summary className="cursor-pointer text-sm font-medium text-gray-900 dark:text-gray-100">
              {t("How far ahead is a launch announced?")}
            </summary>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              {t("XCP-69 requires the announcement to confirm on-chain before the opening block. Nobody can mint during that interval, including the creator. There is no fixed six-hour notice period in the standard. This site's default schedules the start 36 blocks ahead (about six hours); custom starts can be as close as six blocks (about one hour), or much further away. These are estimates from creation, and confirmation takes some of that time.")}
            </p>
          </details>
          <details className="group p-4" open>
            <summary className="cursor-pointer text-sm font-medium text-gray-900 dark:text-gray-100">
              {t("What do I actually lose if a launch fails?")}
            </summary>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              {t("Your Bitcoin transaction fee — that's it. Every satoshi of XCP you minted with comes back automatically; the protocol has no other outcome. Think of the fee as cheap insurance: you'd much rather pay one transaction fee and get your XCP back than be out both, which is the normal ending on launchpads where a half-filled launch just trades into the floor.")}
            </p>
          </details>
          <details className="p-4">
            <summary className="cursor-pointer text-sm font-medium text-gray-900 dark:text-gray-100">
              {t("Where do I get the XCP to mint with?")}
            </summary>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              {rich(
                t,
                "Minting is paid in XCP on your address's Counterparty balance — BTC only covers miner fees. The fastest no-account route is an on-chain dispenser: send BTC, the protocol vends XCP automatically. {link}. A max mint is 10 XCP; a launch needs 0.5 XCP for the name.",
                {
                  link: (
                    <LazyLink href="/dispense" className={linkClass}>
                      {t("Buy from the cheapest dispensers here")}
                    </LazyLink>
                  ),
                },
              )}
            </p>
          </details>
          <details className="p-4">
            <summary className="cursor-pointer text-sm font-medium text-gray-900 dark:text-gray-100">
              {t("What happens to the token itself if a launch fails?")}
            </summary>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              {t("It ceases to exist — permanently. At the deadline, consensus destroys every minted token out of protocol escrow (they never touched anyone's wallet), refunds every minter's XCP, and closes the asset locked at zero supply. Nothing lingers in any wallet: no frozen tokens, no dust — minters end bit-identical to never having participated, minus one miner fee. The name itself becomes a tombstone: registered forever, mintable never. Worth weighing if you launch with a name you already own — a failed launch buries the name with the launch.")}
            </p>
          </details>
          <details className="p-4">
            <summary className="cursor-pointer text-sm font-medium text-gray-900 dark:text-gray-100">
              {t("Can I launch on a token name that already exists?")}
            </summary>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              {rich(
                t,
                "Yes — and a name with history is a feature. But only the name comes along: consensus requires {zero} at launch (the all-or-nothing equation only balances at zero), so even a decade-old name starts with a clean cap table — the 69M + 31M minted at launch is all the supply that has ever existed. You must be the asset's current issuer, it must be unlocked, and it must already be divisible. If it carries supply, destroy every unit first — and supply in other people's hands can't be destroyed, which permanently disqualifies the name. There is no grandfathering old holders; that would be a premine with extra steps.",
                { zero: <em>{t("zero existing supply")}</em> },
              )}
            </p>
          </details>
          <details className="p-4">
            <summary className="cursor-pointer text-sm font-medium text-gray-900 dark:text-gray-100">
              {t("Are all Counterparty fairminters like this?")}
            </summary>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              {t("No — and that's the point. The fairminter protocol allows enormous variation: no soft cap, no refunds, creator commissions up to 99%, premines, no pool at all. XCP-69 pins one configuration of it, and this site lists only launches that match the standard exactly, checked field-by-field against the on-chain record. Here, every launch behaves identically and you never audit the parameters yourself. A fairminter you encounter anywhere else carries no such guarantee — read its fields before you mint.")}
            </p>
          </details>
          <details className="p-4">
            <summary className="cursor-pointer text-sm font-medium text-gray-900 dark:text-gray-100">
              {t("Can someone fake the crowd?")}
            </summary>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              {t("Partially. The 10 XCP per-address cap makes a fake crowd cost at least 69 funded addresses — it raises the price of the act, it cannot prevent it. Sybil-resistant in cost, not in principle. The mint tape, address histories, and holder spread are all public, so a manufactured crowd has to fake those too.")}
            </p>
          </details>
          <details className="p-4">
            <summary className="cursor-pointer text-sm font-medium text-gray-900 dark:text-gray-100">
              {t("Does a refund make me whole?")}
            </summary>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              {t("In XCP terms, exactly. In fiat terms, only if XCP's price held during the ~week-long window. Refunds return quantity, not value.")}
            </p>
          </details>
          <details className="p-4">
            <summary className="cursor-pointer text-sm font-medium text-gray-900 dark:text-gray-100">
              {t("Is the {mult}× opening premium a price guarantee?", { mult })}
            </summary>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              {t("No — it's structural, not promised. The pool must open at 69/31 of mint price because those are the only quantities that exist, but the floor decays as people sell into it. Nothing stops a token trading below mint. What the pool guarantees is a bid that never reaches zero, not a bid you'll like.")}
            </p>
          </details>
          <details className="p-4">
            <summary className="cursor-pointer text-sm font-medium text-gray-900 dark:text-gray-100">
              {t("Where does the token art actually live?")}
            </summary>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              {t("Off-chain by default: the chain permanently carries the URL of the asset-info JSON, and the content behind it is curatable by the asset's current owner (wallet-signature gated). Taproot creators can instead inscribe the image on-chain as the permanent description — no off-chain dependency at all. Either way, nothing economic depends on hosted content.")}
            </p>
          </details>
        </div>
      </section>

      <p className="text-sm text-gray-500 dark:text-gray-400">
        {rich(
          t,
          "Full specification with raw compose values and the conformance predicate: {spec}. Conformance is checked field-by-field on-chain — this site lists only launches that match exactly.",
          {
            spec: (
              <a
                href="https://github.com/XCP/launchpad/blob/main/docs/xcp-69.md"
                className={linkClass}
                target="_blank"
                rel="noreferrer"
              >
                docs/xcp-69.md
              </a>
            ),
          },
        )}
      </p>
    </article>
  );
}
