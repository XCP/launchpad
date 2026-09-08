"use client";

import { useEffect, useId, useRef, useState } from "react";
import { FOCUS } from "@/components/ui/tokens";
import { useT } from "@/lib/i18n/client";
import { useNumbers } from "@/lib/i18n/numbers";
import { ratio } from "@/lib/numeric";
import { XCP69_EXACT } from "@/lib/xcp69";

const TARGET_RAW =
  (XCP69_EXACT.SOFT_CAP / XCP69_EXACT.QUANTITY_BY_PRICE) * XCP69_EXACT.PRICE;
const EXAMPLE_TOKENS_RAW = XCP69_EXACT.MAX_MINT_PER_ADDRESS;
const EXAMPLE_PAYMENT_RAW =
  (EXAMPLE_TOKENS_RAW / XCP69_EXACT.QUANTITY_BY_PRICE) * XCP69_EXACT.PRICE;
// Slider units are illustrative increments of XCP, not a count of people.
const MAX_UNITS = ratio(TARGET_RAW, EXAMPLE_PAYMENT_RAW);
const STARTING_UNITS = Math.floor(MAX_UNITS * 0.6);
type StoryState = "scheduled" | "minting" | "launched" | "refunded";

/** A local illustration. It never composes or submits a transaction. */
export function LaunchStory({ className = "" }: { className?: string }) {
  const t = useT();
  const num = useNumbers();
  const titleId = useId();
  const sliderId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<StoryState>("scheduled");
  const previousState = useRef(state);
  const [units, setUnits] = useState(STARTING_UNITS);
  const raisedRaw = BigInt(units) * EXAMPLE_PAYMENT_RAW;
  const progress = ratio(raisedRaw, TARGET_RAW);
  const amount = num.commasRaw(EXAMPLE_PAYMENT_RAW);
  const tokens = num.commasRaw(EXAMPLE_TOKENS_RAW);
  const target = num.commasRaw(TARGET_RAW);
  const raised = num.commasRaw(raisedRaw);
  const poolTokens = num.commasRaw(XCP69_EXACT.POOL_QUANTITY);
  const status = {
    scheduled: t("Scheduled"),
    minting: t("Minting"),
    launched: t("Graduated"),
    refunded: t("Refunded"),
  }[state];
  const step = state === "scheduled" ? 1 : state === "minting" ? 2 : 3;
  const actionClass = `inline-flex min-h-11 items-center justify-center rounded-lg bg-purple-600 px-4 py-2 font-medium text-white hover:bg-purple-700 ${FOCUS}`;
  const textActionClass = `min-h-11 text-sm font-medium text-purple-700 underline underline-offset-4 dark:text-purple-300 ${FOCUS}`;

  // A stage change removes the control that triggered it. Move keyboard focus
  // into its replacement, without jumping the page or stealing initial focus.
  useEffect(() => {
    if (previousState.current !== state) panel.current?.focus({ preventScroll: true });
    previousState.current = state;
  }, [state]);

  function openMint() {
    setUnits(STARTING_UNITS);
    setState("minting");
  }

  return (
    <section
      id="launch-example"
      aria-labelledby={titleId}
      className={`scroll-mt-24 rounded-2xl border border-gray-200 bg-white p-4 text-sm text-gray-900 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-100 sm:p-6 ${className}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={titleId} className="text-lg font-semibold">{t("Try a launch")}</h2>
        <span className="rounded-full bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700 dark:bg-purple-950/50 dark:text-purple-300">
          {status}
        </span>
      </div>

      <ol aria-label={t("Launch stages")} className="my-5 flex flex-wrap items-center gap-x-3 border-b border-gray-100 pb-3 text-xs dark:border-gray-800">
        <li>
          <button type="button" aria-current={step === 1 ? "step" : undefined} onClick={() => setState("scheduled")} className={`min-h-11 font-medium ${step === 1 ? "text-purple-700 dark:text-purple-300" : "text-gray-500 dark:text-gray-400"} ${FOCUS}`}>
            {t("Before mint")}
          </button>
        </li>
        <li aria-hidden className="text-gray-400">→</li>
        <li>
          <button type="button" aria-current={step === 2 ? "step" : undefined} onClick={openMint} className={`min-h-11 font-medium ${step === 2 ? "text-purple-700 dark:text-purple-300" : "text-gray-500 dark:text-gray-400"} ${FOCUS}`}>
            {t("Mint")}
          </button>
        </li>
        <li aria-hidden className="text-gray-400">→</li>
        <li aria-current={step === 3 ? "step" : undefined} className={`font-medium ${step === 3 ? "text-purple-700 dark:text-purple-300" : "text-gray-500 dark:text-gray-400"}`}>
          {t("Outcome")}
        </li>
      </ol>

      <div ref={panel} role="group" tabIndex={-1} aria-label={status} className="min-h-64 outline-none">
        {state === "scheduled" && (
          <div className="space-y-4">
            <h3 className="text-xl font-semibold">{t("Announced before anyone can mint")}</h3>
            <p className="leading-relaxed text-gray-600 dark:text-gray-400">
              {t("The launch confirms on-chain with a future opening block. Everyone can see the terms; nobody, including the creator, can mint yet.")}
            </p>
            <p className="leading-relaxed text-gray-600 dark:text-gray-400">
              {t("Time to discover the launch, read its terms and decide.")}
            </p>
            <button type="button" onClick={openMint} className={actionClass}>
              {t("Open the mint")}<span aria-hidden className="ml-2">→</span>
            </button>
          </div>
        )}

        {state === "minting" && (
          <div className="space-y-4">
            <h3 className="text-xl font-semibold">{t("The same mint price for everyone")}</h3>
            <p className="leading-relaxed text-gray-600 dark:text-gray-400">
              {t("In this example, you commit {amount} XCP for {tokens} tokens if the mint fills. Your XCP waits in escrow. No creator allocation.", { amount, tokens })}
            </p>
            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="tabular-nums">
                  <strong className="text-2xl">{raised}</strong>
                  <span className="text-gray-500 dark:text-gray-400"> / {target} XCP</span>
                </p>
                <span className="text-xs text-gray-500 dark:text-gray-400">{num.percent(progress, { digits: 0 })}</span>
              </div>
              <label htmlFor={sliderId} className="mt-3 block text-xs font-medium text-gray-500 dark:text-gray-400">{t("Drag to fill the mint")}</label>
              <div className="flex h-11 items-center">
                <input
                  id={sliderId}
                  type="range"
                  min={1}
                  max={MAX_UNITS}
                  step={1}
                  value={units}
                  aria-label={t("Example launch funding")}
                  aria-valuetext={t("{raised} of {target} XCP", { raised, target })}
                  onChange={(event) => {
                    const nextUnits = Number(event.target.value);
                    setUnits(nextUnits);
                    if (nextUnits === MAX_UNITS) setState("launched");
                  }}
                  className={`ui-slider w-full ${FOCUS}`}
                  style={{ background: `linear-gradient(to right, #a855f7 ${progress * 100}%, var(--slider-track) ${progress * 100}%)` }}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <p className="text-xs text-gray-500 dark:text-gray-400">{t("Fill it by the deadline to open the pool.")}</p>
              <button type="button" onClick={() => setState("refunded")} className={textActionClass}>{t("Let the deadline pass")}</button>
            </div>
          </div>
        )}

        {state === "launched" && (
          <div className="space-y-4">
            <h3 className="text-xl font-semibold">{t("The mint fills. The pool opens.")}</h3>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t("Your tokens")}</p>
              <p className="mt-1 text-3xl font-semibold tabular-nums">{tokens}</p>
            </div>
            <p className="leading-relaxed text-gray-600 dark:text-gray-400">
              {t("The protocol releases your tokens and creates a pool with {target} XCP and {poolTokens} tokens. Nobody can withdraw the initial LP position; buying and selling stay open.", { target, poolTokens })}
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <a href="#launch-pool" className={actionClass}>{t("Try trading through the pool")}<span aria-hidden className="ml-2">↓</span></a>
              <button type="button" onClick={() => { setUnits(STARTING_UNITS); setState("refunded"); }} className={textActionClass}>{t("What if it doesn't fill?")}</button>
            </div>
          </div>
        )}

        {state === "refunded" && (
          <div className="space-y-4">
            <h3 className="text-xl font-semibold">{t("The deadline passes. Your XCP returns.")}</h3>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t("Back at your address")}</p>
              <p className="mt-1 text-3xl font-semibold tabular-nums">{amount} XCP</p>
            </div>
            <p className="leading-relaxed text-gray-600 dark:text-gray-400">
              {t("The mint did not fill, so your XCP is refunded automatically. No trading pool opens. You can use that XCP for another launch.")}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{t("BTC transaction fees are not refunded.")}</p>
            <button type="button" onClick={openMint} className={actionClass}>{t("Try the mint again")}</button>
          </div>
        )}
      </div>

      <p className="mt-5 border-t border-gray-100 pt-3 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">{t("Illustrative launch · no transaction")}</p>
    </section>
  );
}
