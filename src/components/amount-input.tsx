"use client";

/**
 * The industry-consensus money input (every major DEX ships this shape):
 * type="text" + inputMode="decimal" — never type="number", which accepts
 * e/+/-, renders spinners, and blanks invalid intermediate states. State is
 * the raw string so trailing "5." survives; invalid keystrokes are rejected
 * before entering state so the cursor never jumps. Commas normalize to
 * periods; paste is cleaned (strip non-numeric, keep first decimal point)
 * rather than rejected wholesale.
 */
const AMOUNT_REGEX = /^\d*\.?\d*$/;

function sanitize(raw: string): string | null {
  let s = raw.replace(/,/g, ".");
  if (s === "" || AMOUNT_REGEX.test(s)) return s === "." ? "0." : s;
  // Paste path: strip junk, keep only the first decimal point.
  s = s.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
  if (s !== "" && AMOUNT_REGEX.test(s)) return s;
  return null;
}

export function AmountInput({
  value,
  onChange,
  id,
  placeholder = "0",
  ariaLabel,
  className,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      maxLength={26}
      value={value}
      onChange={(e) => {
        const next = sanitize(e.target.value);
        if (next !== null) onChange(next);
      }}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={className}
      disabled={disabled}
    />
  );
}
