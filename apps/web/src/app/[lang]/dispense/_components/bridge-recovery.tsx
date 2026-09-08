"use client";

import { useEffect, useRef, useState } from "react";
import type { Dispenser } from "@/lib/api/counterparty";
import { useT } from "@/lib/i18n/client";
import { useNumbers } from "@/lib/i18n/numbers";
import { ErrorBanner } from "@/components/ui/error-banner";
import { XcpBridge } from "@/app/[lang]/dispense/_components/bridge";

function readBook(value: unknown): Dispenser[] | null {
  if (!value || typeof value !== "object" || !("dispensers" in value) || !Array.isArray(value.dispensers)) return null;
  if (value.dispensers.length > 10 || value.dispensers.some((row) => !row || typeof row !== "object"
    || typeof row.tx_hash !== "string" || typeof row.source !== "string"
    || !Number.isSafeInteger(row.give_quantity) || row.give_quantity !== 100_000_000
    || !Number.isSafeInteger(row.give_remaining) || row.give_remaining <= 0
    || !Number.isSafeInteger(row.satoshirate) || row.satoshirate <= 0
    || typeof row.price !== "number" || !Number.isFinite(row.price))) return null;
  return value.dispensers;
}

export function BridgeRecovery({ dispensers, btcUsd, xcpUsd }: {
  dispensers: Dispenser[] | null;
  btcUsd: number | null;
  xcpUsd: number | null;
}) {
  const t = useT();
  const num = useNumbers();
  const [recovered, setRecovered] = useState<Dispenser[] | undefined>();
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [wait, setWait] = useState(0);
  const [retryAt, setRetryAt] = useState(0);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const book = recovered ?? dispensers;
  const unavailable = failed || book === null;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; request.current?.abort(); };
  }, []);
  useEffect(() => {
    if (retryAt <= Date.now()) return;
    // A local countdown only; reaching zero never starts a network request.
    const timer = setInterval(() => {
      const left = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
      setWait(left);
      if (left === 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [retryAt]);

  const retry = async () => {
    if (request.current || wait > 0) return;
    const controller = new AbortController();
    request.current = controller;
    const timeout = setTimeout(() => controller.abort(), 20_000);
    setPending(true);
    let cooldown = 15;
    try {
      const response = await fetch("/api/xcp-dispensers", { signal: controller.signal });
      const retryAfter = Number(response.headers.get("retry-after"));
      if (Number.isFinite(retryAfter) && retryAfter > 0) cooldown = Math.min(300, Math.max(15, Math.ceil(retryAfter)));
      if (!response.ok) throw new Error("Dispenser book unavailable");
      const rows = readBook(await response.json());
      if (rows === null) throw new Error("Invalid dispenser book");
      if (!mounted.current) return;
      setRecovered(rows); setFailed(false);
    } catch {
      if (!mounted.current) return;
      setFailed(true); setWait(cooldown); setRetryAt(Date.now() + cooldown * 1000);
    } finally {
      clearTimeout(timeout);
      if (request.current === controller) request.current = null;
      if (mounted.current) setPending(false);
    }
  };

  return <div className="space-y-3">
    {unavailable && <ErrorBanner>{t("The service is busy or unavailable. Try again shortly.")}</ErrorBanner>}
    <div className="flex justify-end">
      <button type="button" onClick={() => void retry()} disabled={pending || wait > 0}
        className="rounded px-2 py-1 text-xs font-medium text-purple-600 hover:underline disabled:opacity-50 dark:text-purple-400">
        {pending ? t("Loading…") : wait > 0 ? t("Wait {n}s", { n: num.commas(wait) }) : unavailable ? t("Retry") : t("Refresh")}
      </button>
    </div>
    {/* Preserve known rows and the mounted form after a failed refresh, while
        preventing a new action against a book we could not revalidate. */}
    {book !== null && <fieldset disabled={unavailable || pending} className="min-w-0" aria-busy={pending}>
      <XcpBridge dispensers={book} btcUsd={btcUsd} xcpUsd={xcpUsd} />
    </fieldset>}
  </div>;
}
