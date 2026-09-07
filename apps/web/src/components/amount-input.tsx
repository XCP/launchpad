"use client";

/**
 * The industry-consensus money input (every major DEX ships this shape):
 * type="text" + inputMode="decimal" — never type="number", which accepts
 * e/+/-, renders spinners, and blanks invalid intermediate states. State is
 * the raw string so trailing "5." survives. Every locale uses Counterparty
 * notation here: ASCII digits and at most eight places after a period.
 * Reject unsupported input instead of removing characters or guessing at
 * grouping: a valid-looking result can represent a different amount.
 */
const AMOUNT_REGEX = /^\d*(?:\.\d{0,8})?$/;
const MAX_AMOUNT_LENGTH = 26;

/** Raw satoshi fields use zero places; token-unit fields use eight. */
export function sanitizeAmount(raw: string, decimals: 0 | 8 = 8): string | null {
  if (raw.length > MAX_AMOUNT_LENGTH || !(decimals === 0 ? /^\d*$/ : AMOUNT_REGEX).test(raw)) return null;
  return raw === "." ? "0." : raw;
}

export function AmountInput({
  value,
  onChange,
  id,
  placeholder = "0",
  ariaLabel,
  className,
  style,
  disabled,
  decimals = 8,
}: {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  /** For transient visual states (e.g. graying a derived value while stale). */
  style?: React.CSSProperties;
  disabled?: boolean;
  decimals?: 0 | 8;
}) {
  return (
    <input
      id={id}
      type="text"
      inputMode={decimals === 0 ? "numeric" : "decimal"}
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      value={value}
      onChange={(e) => {
        // A regional decimal keyboard can emit a comma. Translate that one
        // keystroke to our period notation; pasted/dropped text must already
        // use the plain format, since "1,234" could be a grouped integer.
        const event = e.nativeEvent as InputEvent;
        const decimalKey = event.inputType === "insertText" && event.data === ",";
        const raw = decimalKey ? e.target.value.replace(",", ".") : e.target.value;
        // Validate length here too. Native maxLength truncates pasted text
        // before onChange, potentially removing significant digits.
        const next = sanitizeAmount(raw, decimals);
        if (next !== null) onChange(next);
      }}
      onPaste={(e) => {
        // Text inputs strip line breaks before onChange. Inspect the original
        // clipboard text so "1\n234" cannot silently become "1234".
        if (sanitizeAmount(e.clipboardData.getData("text"), decimals) === null) e.preventDefault();
      }}
      onDrop={(e) => {
        if (sanitizeAmount(e.dataTransfer.getData("text"), decimals) === null) e.preventDefault();
      }}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={className}
      style={style}
      disabled={disabled}
    />
  );
}
