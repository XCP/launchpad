"use client";

import type { ReactNode } from "react";

/** Explorer link for a broadcast transaction. */
export function TxLink({ txid }: { txid: string }) {
  return (
    <a
      href={`https://xcp.io/tx/${txid}`}
      target="_blank"
      rel="noreferrer"
      className="underline"
    >
      {txid.slice(0, 12)}…
    </a>
  );
}

/**
 * The green post-broadcast card. Broadcast ≠ done: the body should say
 * what happens at confirmation, and the reset link starts the next round.
 */
export function ConfirmCard({
  title,
  onReset,
  resetLabel,
  children,
}: {
  title: ReactNode;
  onReset: () => void;
  resetLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/40 p-5 text-sm">
      <div className="font-semibold text-green-800 dark:text-green-300">{title}</div>
      {children}
      <button
        type="button"
        onClick={onReset}
        className="mt-2 text-green-800 dark:text-green-300 underline"
      >
        {resetLabel}
      </button>
    </div>
  );
}
