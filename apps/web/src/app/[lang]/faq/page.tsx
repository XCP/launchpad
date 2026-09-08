import type { Metadata } from "next";
import { isLocale } from "@/lib/i18n/locales";
import { rich } from "@/lib/i18n/rich";
import { localeAlternates } from "@/lib/i18n/seo";
import { getMessages, getT } from "@/lib/i18n/server";
import { makeT, msg } from "@/lib/i18n/t";
import { LazyLink } from "@/components/lazy-link";
import { fetchXcpUsd } from "@/lib/api/price";
import {
  XCP69_MIN_PARTICIPANTS,
  XCP69_OPENING_MULTIPLE,
} from "@/lib/xcp69";
import { StandardPlayground } from "@/app/[lang]/faq/_components/explainer";

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
        <h1 className="text-3xl font-bold">{t("Mints out, or your XCP back.")}</h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          {t("A new way to launch a coin on Counterparty — every launch identical, enforced by consensus.")}
        </p>
      </div>

      <section className="holo-border rounded-xl p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <h2 className="font-bold">{t("The XCP-69 standard")}</h2>
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {t("guaranteed by consensus, not this website")}
          </span>
        </div>
        <ul className="mt-4 grid gap-x-6 gap-y-3 text-sm font-medium text-gray-800 dark:text-gray-200 sm:grid-cols-2">
          <li className="flex items-center gap-2.5">
            <span aria-hidden>⚖️</span>{t("Mints out, or full refund")}
          </li>
          <li className="flex items-center gap-2.5">
            <span aria-hidden>🔒</span>{t("Liquidity locked forever")}
          </li>
          <li className="flex items-center gap-2.5">
            <span aria-hidden>🚫</span>{t("No platform, no creator fees")}
          </li>
          <li className="flex items-center gap-2.5">
            <span aria-hidden>👥</span>
            {t("{n}+ addresses to sell out", { n: XCP69_MIN_PARTICIPANTS })}
          </li>
          <li className="flex items-center gap-2.5">
            <span aria-hidden>📢</span>{t("Announced before minting opens")}
          </li>
          <li className="flex items-center gap-2.5">
            <span aria-hidden>📈</span>{t("Opens at {mult}× mint price", { mult })}
          </li>
        </ul>
      </section>

      <section>
        <h2 className="mb-3 font-bold">{t("Feel the mechanism")}</h2>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
          {t("The whole standard, hands-on — starting, like every launch, with the mint.")}
        </p>
        <StandardPlayground xcpUsd={xcpUsd}>
          <div className="rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
            <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
              <h3 className="font-semibold">{t("3 · All coins are the same")}</h3>
              <div className="text-right">
                <span className="text-3xl font-bold text-gray-900 dark:text-gray-100">0</span>
                <span className="text-sm text-gray-400 dark:text-gray-500"> {t("gotchas")}</span>
              </div>
            </div>
            <dl className="mt-3 divide-y divide-gray-100 dark:divide-gray-800 text-sm">
              {PARAMS.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 py-2.5">
                  <dt className="text-gray-500 dark:text-gray-400">{t(k)}</dt>
                  <dd className="text-right font-medium">{t(v)}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
              {t("No slider on this one — there is nothing to configure. Every launch is identical, checked field-by-field against the on-chain record.")}
            </p>
          </div>
        </StandardPlayground>
      </section>

      <section>
        <h2 className="mb-2 font-bold">{t("FAQ")}</h2>
        <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
          {t("The honest questions — including the ones that don't flatter us.")}
        </p>
        <div className="divide-y divide-gray-100 dark:divide-gray-800 rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
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
              {t("At the deadline, consensus destroys the escrowed launch tokens, returns each minter's contributed XCP, and closes the asset at zero supply with issuance locked. Bitcoin transaction fees are not refunded. The name stays registered and cannot be minted again. If you launch with a name you already own, a failed launch permanently closes minting for that name.")}
            </p>
          </details>
          <details className="p-4">
            <summary className="cursor-pointer text-sm font-medium text-gray-900 dark:text-gray-100">
              {t("Can I launch on a token name that already exists?")}
            </summary>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              {rich(
                t,
                "Yes. You must be the current issuer of an unlocked, divisible asset with {zero} before the launch. If supply remains, its holders must destroy all of it first; you cannot destroy units held by other addresses. A successful XCP-69 launch creates 69M sale tokens and 31M pool tokens. Earlier issuance and destruction remain in the asset's history.",
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
              {t("The opening reserve ratio sets a price above the mint price, but it does not guarantee a profitable sale. Selling changes the pool price; swap fees, Bitcoin fees, and other trades affect what you receive. A token can trade below its mint price.")}
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
