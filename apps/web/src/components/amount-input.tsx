"use client";

import { useId } from "react";
import { COUNTERPARTY_MAX_INT, parseAmountDraft } from "@xcp/wallet-sdk/amounts";
import { useT } from "@/lib/i18n/client";
import { visibleDraft } from "@/lib/amount-draft";

/** Keep the complete draft. Validation never edits the value being entered. */
export function AmountInput({
  value, onChange, id, placeholder = "0", ariaLabel, className, style, disabled,
  decimals = 8, min = 0, max, error,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  style?: React.CSSProperties;
  disabled?: boolean;
  decimals?: 0 | 8;
  min?: number;
  max?: number;
  error?: string;
}) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const t = useT();
  const result = parseAmountDraft(value, {
    decimals,
    minRaw: BigInt(Math.round(min * 10 ** decimals)),
    maxRaw: max === undefined ? COUNTERPARTY_MAX_INT : BigInt(Math.round(max * 10 ** decimals)),
  });
  const message = error ?? (result.status === "invalid" || result.status === "incomplete"
    ? result.status === "invalid" && result.code === "amount_range" && max !== undefined
      ? t("Enter a value from {min} to {max}.", { min, max })
      : decimals === 0
        ? t("Use whole numbers only.")
        : t("Use digits and a dot, with up to {n} decimal places.", { n: decimals })
    : null);
  return (
    <>
      <input
        id={inputId}
        type="text"
        inputMode={decimals === 0 ? "numeric" : "decimal"}
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPaste={(e) => {
          e.preventDefault();
          const input = e.currentTarget;
          const start = input.selectionStart ?? value.length;
          const end = input.selectionEnd ?? start;
          onChange(value.slice(0, start) + visibleDraft(e.clipboardData.getData("text")) + value.slice(end));
        }}
        onDrop={(e) => {
          e.preventDefault();
          onChange(visibleDraft(e.dataTransfer.getData("text")));
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        aria-invalid={Boolean(message)}
        data-error-code={result.status === "invalid" ? result.code : result.status === "incomplete" ? "amount_incomplete" : undefined}
        aria-describedby={message ? `${inputId}-error` : undefined}
        className={className}
        style={style}
        disabled={disabled}
      />
      {message && <span id={`${inputId}-error`} role="status" className="order-last block w-full basis-full whitespace-normal break-words text-left text-xs text-red-600 dark:text-red-400">{message}</span>}
    </>
  );
}
