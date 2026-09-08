"use client";

import { useId, type ReactNode } from "react";
import { useT } from "@/lib/i18n/client";
import { useNumbers } from "@/lib/i18n/numbers";
import { ratio } from "@/lib/numeric";
import { XCP69_EXACT } from "@/lib/xcp69";

const TARGET_RAW =
  (XCP69_EXACT.SOFT_CAP / XCP69_EXACT.QUANTITY_BY_PRICE) * XCP69_EXACT.PRICE;
const EXAMPLE_TOKENS_RAW = XCP69_EXACT.MAX_MINT_PER_ADDRESS;
const EXAMPLE_PAYMENT_RAW =
  (EXAMPLE_TOKENS_RAW / XCP69_EXACT.QUANTITY_BY_PRICE) * XCP69_EXACT.PRICE;
const ADDRESS_COUNT = ratio(XCP69_EXACT.SOFT_CAP, EXAMPLE_TOKENS_RAW);
// One illustrative point before the target fills, using whole contributions.
const PARTIAL_ADDRESS_COUNT = Math.floor(ADDRESS_COUNT / 3);
const PARTIAL_RAISED_RAW = BigInt(PARTIAL_ADDRESS_COUNT) * EXAMPLE_PAYMENT_RAW;
const MUTED = "text-gray-500 dark:text-gray-400";

/** A collective launch illustrated with the standard's exact quantities. */
export function LaunchStory({ className = "" }: { className?: string }) {
  const t = useT();
  const num = useNumbers();
  const id = useId();
  const count = num.commas(ADDRESS_COUNT);
  const partialCount = num.commas(PARTIAL_ADDRESS_COUNT);
  const payment = num.commasRaw(EXAMPLE_PAYMENT_RAW);
  const target = num.commasRaw(TARGET_RAW);
  const partial = num.commasRaw(PARTIAL_RAISED_RAW);
  const perAddress = num.commasRaw(EXAMPLE_TOKENS_RAW);
  const publicTokens = num.commasRaw(XCP69_EXACT.SOFT_CAP);

  return (
    <section
      id="launch-example"
      aria-labelledby={`${id}-title`}
      className={`scroll-mt-24 text-sm text-gray-900 dark:text-gray-100 ${className}`}
    >
      <h2 id={`${id}-title`} className="text-xl font-semibold">{t("A launch built together")}</h2>
      <p className={`mt-2 leading-relaxed ${MUTED}`}>
        {t("One example: {count} addresses, each contributing {payment} XCP. Smaller contributions need more addresses.", { count, payment })}
      </p>
      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="size-3 border border-gray-300 bg-gray-100 dark:border-gray-600 dark:bg-gray-800" />
          {t("One address")}
        </span>
        <span className="inline-flex items-center gap-2"><XcpChip />XCP</span>
        <span className="inline-flex items-center gap-2"><TokenChip />{t("Launch tokens")}</span>
      </div>

      <div className="mt-8 grid gap-x-8 gap-y-10 md:grid-cols-2">
        <Frame
          id={`${id}-frame-1`}
          number={num.commas(1)}
          title={t("Announced before minting")}
          caption={t("Time to discover it. Nobody gets an early mint.")}
        >
          <p className={`text-center text-xs ${MUTED}`}>
            {t("{count} addresses can see the same terms", { count })}
          </p>
          <AddressGrid active={0} label={t("{count} illustrative addresses before minting opens", { count })} />
          <div className="py-4">
            <div className="flex justify-between gap-3 text-xs">
              <span>{t("Announced")}</span><span className="text-right">{t("Future block")}</span>
            </div>
            <div aria-hidden className="relative my-4 h-px bg-gray-300 dark:bg-gray-600">
              <span className="absolute -top-1 left-0 size-2 bg-gray-400 dark:bg-gray-500" />
              <span className="absolute -top-1 right-0 size-2 bg-gray-400 dark:bg-gray-500" />
            </div>
            <p className="text-center font-medium">{t("Minting has not opened")}</p>
            <p className={`mt-2 text-center text-xs ${MUTED}`}>{t("XCP stays at each address")}</p>
          </div>
        </Frame>

        <Frame
          id={`${id}-frame-2`}
          number={num.commas(2)}
          title={t("Back it together")}
          caption={t("Individual commitments become a shared target.")}
        >
          <p className="text-center text-xs font-medium">
            {t("{count} addresses · {payment} XCP each", { count: partialCount, payment })}
          </p>
          <AddressGrid
            active={PARTIAL_ADDRESS_COUNT}
            label={t("{active} of {count} example addresses have contributed XCP", { active: partialCount, count })}
          />
          <ContributionFlow />
          <Escrow amountRaw={PARTIAL_RAISED_RAW} />
        </Frame>

        <Frame
          id={`${id}-frame-3`}
          number={num.commas(3)}
          title={t("Fill the target")}
          caption={t("Same mint price. No creator allocation.")}
        >
          <p className="text-center text-xs font-medium">
            {t("{count} addresses · {payment} XCP each", { count, payment })}
          </p>
          <AddressGrid
            active={ADDRESS_COUNT}
            label={t("All {count} example addresses have contributed XCP", { count })}
          />
          <ContributionFlow />
          <Escrow amountRaw={TARGET_RAW} />
        </Frame>

        <Frame
          id={`${id}-frame-4`}
          number={num.commas(4)}
          title={t("Commitments become a market")}
          caption={t("The protocol releases tokens and creates the pool automatically.")}
        >
          <p className="text-center text-xs font-medium">
            {t("{tokens} tokens → {count} addresses", { tokens: publicTokens, count })}
          </p>
          <AddressGrid
            active={ADDRESS_COUNT}
            kind="token"
            label={t("All {count} example addresses receive {tokens} tokens each", { count, tokens: perAddress })}
          />
          <p className={`text-center text-xs ${MUTED}`}>{t("{tokens} tokens at each address", { tokens: perAddress })}</p>
          <p className="pt-2 text-center text-xs font-medium">
            {t("{target} XCP from their commitments", { target })}
          </p>
          <svg aria-hidden viewBox="0 0 100 28" className="-my-1 h-7 w-full text-gray-400 dark:text-gray-500">
            <path d="M50 2V24M46 20L50 24L54 20" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          <PoolReserves />
        </Frame>

        <Frame
          id={`${id}-frame-5`}
          number={num.commas(5)}
          title={t("Trade through locked LP")}
          caption={t("Trading moves the reserves. Initial LP cannot be withdrawn.")}
        >
          <p className="text-center text-xs font-medium">{t("Contributors become traders")}</p>
          <AddressGrid
            active={ADDRESS_COUNT}
            kind="token"
            label={t("{count} example addresses can buy and sell through the pool", { count })}
          />
          <div className="relative h-14">
            <svg aria-hidden viewBox="0 0 300 56" preserveAspectRatio="none" className="absolute inset-0 size-full">
              <path d="M60 3V50M56 46L60 50L64 46M73 50V3M69 7L73 3L77 7" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-purple-500 dark:text-purple-400" />
              <path d="M225 3V50M221 46L225 50L229 46M238 50V3M234 7L238 3L242 7" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-cyan-500 dark:text-cyan-400" />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-xs">{t("Buy and sell")}</span>
          </div>
          <PoolReserves trading />
          <p className="text-center text-xs font-medium">{t("Initial LP ownership: locked")}</p>
        </Frame>

        <Frame
          id={`${id}-frame-6`}
          number={num.commas(6)}
          title={t("Or: the deadline arrives")}
          caption={t("XCP ready for another idea. BTC fees are not returned.")}
        >
          <p className="text-xs font-medium">
            {t("Alternate ending: the unfilled mint in frame {number}", { number: num.commas(2) })}
          </p>
          <p className="text-center text-xs font-medium">
            {t("Back to the same {count} addresses", { count: partialCount })}
          </p>
          <AddressGrid
            active={PARTIAL_ADDRESS_COUNT}
            label={t("The same {count} contributing addresses receive their XCP back", { count: partialCount })}
          />
          <ContributionFlow reverse />
          <p className="text-center font-medium tabular-nums">{t("{amount} XCP refunded automatically", { amount: partial })}</p>
          <p className={`text-center text-xs ${MUTED}`}>{t("Target unfilled · no pool opens")}</p>
        </Frame>
      </div>
    </section>
  );
}

function Frame({ id, number, title, caption, children }: {
  id: string;
  number: string;
  title: string;
  caption: string;
  children: ReactNode;
}) {
  return (
    <figure aria-labelledby={id} className="flex min-w-0 flex-col gap-4">
      <h3 id={id} className="text-base font-semibold">{number}. {title}</h3>
      <div className="flex flex-1 flex-col gap-3">{children}</div>
      <figcaption className={`text-xs leading-relaxed ${MUTED}`}>{caption}</figcaption>
    </figure>
  );
}

function XcpChip() {
  return <span aria-hidden className="inline-block size-2.5 shrink-0 rounded-full bg-purple-500 dark:bg-purple-400" />;
}

function TokenChip() {
  return <span aria-hidden className="inline-block size-2 shrink-0 rotate-45 bg-cyan-500 dark:bg-cyan-400" />;
}

function AddressGrid({ active, kind = "xcp", label }: { active: number; kind?: "xcp" | "token"; label: string }) {
  return (
    <div role="img" aria-label={label} className="grid grid-cols-[repeat(23,minmax(0,1fr))] gap-1">
      {Array.from({ length: ADDRESS_COUNT }, (_, index) => (
        <span
          key={index}
          aria-hidden
          data-address-node={index + 1}
          data-active={index < active}
          className="flex aspect-square min-w-0 items-center justify-center border border-gray-200 bg-gray-100 dark:border-gray-700 dark:bg-gray-800"
        >
          {index < active && (
            <span className={`size-[55%] ${kind === "xcp" ? "rounded-full bg-purple-500 dark:bg-purple-400" : "rotate-45 bg-cyan-500 dark:bg-cyan-400"}`} />
          )}
        </span>
      ))}
    </div>
  );
}

function ContributionFlow({ reverse = false }: { reverse?: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 300 56" preserveAspectRatio="none" className="h-14 w-full text-gray-400 dark:text-gray-500">
      <g>
        <path
          d={reverse
            ? "M130 49L45 4M49 12L45 4L54 5M150 49V4M146 9L150 4L154 9M170 49L255 4M246 5L255 4L251 12"
            : "M45 4L130 49M124 42L130 49L121 49M150 4V49M146 44L150 49L154 44M255 4L170 49M179 49L170 49L176 42"}
          fill="none" stroke="currentColor" strokeWidth="1.5"
        />
        <g className="fill-purple-500 dark:fill-purple-400">
          <circle cx="61" cy="13" r="3.5" /><circle cx="150" cy="17" r="3.5" /><circle cx="239" cy="13" r="3.5" />
        </g>
      </g>
    </svg>
  );
}

function Escrow({ amountRaw }: { amountRaw: bigint }) {
  const t = useT();
  const num = useNumbers();
  const amount = num.commasRaw(amountRaw);
  const target = num.commasRaw(TARGET_RAW);
  const percent = ratio(amountRaw, TARGET_RAW) * 100;
  return (
    <div className="space-y-3">
      <p className="text-center font-medium tabular-nums">{amount} / {target} XCP</p>
      <div
        role="progressbar"
        aria-label={t("Protocol escrow")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={t("{amount} of {target} XCP", { amount, target })}
        className="h-6 overflow-hidden rounded bg-gray-100 dark:bg-gray-800"
      >
        <div className="h-full bg-purple-400 dark:bg-purple-500" style={{ width: `${percent}%` }} />
      </div>
      <p className={`text-center text-xs ${MUTED}`}>{t("Protocol escrow")}</p>
    </div>
  );
}

function PoolReserves({ trading = false }: { trading?: boolean }) {
  const t = useT();
  const num = useNumbers();
  return (
    <div>
      <div className="grid grid-cols-2 gap-1">
        <div className="flex min-w-0 flex-col items-center gap-2 rounded bg-purple-50 px-2 py-3 text-center dark:bg-purple-950/50">
          <XcpChip />
          <span className="text-xs font-medium tabular-nums">{trading ? t("XCP reserve") : `${num.commasRaw(TARGET_RAW)} XCP`}</span>
        </div>
        <div className="flex min-w-0 flex-col items-center gap-2 rounded bg-cyan-50 px-2 py-3 text-center dark:bg-cyan-950/40">
          <TokenChip />
          <span className="text-xs font-medium tabular-nums">
            {trading ? t("Token reserve") : t("{tokens} tokens", { tokens: num.commasRaw(XCP69_EXACT.POOL_QUANTITY) })}
          </span>
        </div>
      </div>
      <p className={`mt-2 text-center text-xs ${MUTED}`}>{t("Trading pool")}</p>
    </div>
  );
}
