"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n/client";

/** Stable codes localize the action; original diagnostics remain copyable. */
export function ComposeError({ error, errorCode, errorDetails }: {
  error: string | null;
  errorCode?: string | null;
  errorDetails?: { diagnostic: string; walletCode?: number } | null;
}) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  if (!error) return null;
  const code = errorCode ?? "unknown_error";
  const message = code.startsWith("amount_") || code === "invalid_argument"
    ? t("Check the amount, units, and decimal places.")
    : code === "transaction_mismatch"
      ? t("The transaction did not match the verified request. It was blocked.")
      : code === "user_rejected"
        ? t("Request declined in wallet.")
        : ["unauthorized", "disconnected", "wallet_missing", "wallet_choice"].includes(code)
          ? t("Reconnect your wallet and try again.")
          : ["network", "rate_limited", "timeout"].includes(code)
            ? t("The service is busy or unavailable. Try again shortly.")
            : t("Your wallet could not complete this request. Check the details.");
  const diagnostic = JSON.stringify({ code, ...errorDetails, diagnostic: errorDetails?.diagnostic ?? error }, null, 2);
  return <div data-error-code={code}>
    <p>{message}</p>
    <details className="mt-1 text-xs">
      <summary className="cursor-pointer">{t("Technical details")}</summary>
      <pre className="mt-2 max-w-full whitespace-pre-wrap break-words select-text">{diagnostic}</pre>
      <button type="button" className="mt-1 underline" onClick={async () => {
        try { await navigator.clipboard.writeText(diagnostic); setCopied(true); }
        catch { setCopied(false); }
      }}>{copied ? t("Copied") : t("Copy diagnostics")}</button>
    </details>
  </div>;
}
