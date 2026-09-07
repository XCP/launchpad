"use client";

/**
 * The industry-consensus money input (every major DEX ships this shape):
 * type="text" + inputMode="decimal" — never type="number", which accepts
 * e/+/-, renders spinners, and blanks invalid intermediate states. State is
 * the raw string so trailing "5." survives; invalid keystrokes are rejected
 * before entering state so the cursor never jumps. State is always a period
 * decimal, whatever the page's language writes — the field is a machine
 * amount on its way to a bigint, not a display.
 */
const AMOUNT_REGEX = /^\d*\.?\d*$/;

/** A whole number written with group separators, in either convention. */
const GROUPED = /^\d{1,3}(?:\.\d{3})+$|^\d{1,3}(?:,\d{3})+$/;

/**
 * Which of "." and "," the writer meant as the decimal mark.
 *
 * A person on a Portuguese or French page types "0,5", and pastes figures
 * grouped the way their language groups them: "1.234,56" there, "1,234.56"
 * here. Both marks appear in both roles, so the string decides rather than
 * the locale — the LAST of the two distinct marks is the decimal one and
 * anything before it groups. A mark that repeats can only be grouping, and
 * a lone mark is the decimal, which is what lets a typed "0," become "0."
 * mid-keystroke.
 */
export function normalizeMarks(raw: string): string {
  const lastDot = raw.lastIndexOf(".");
  const lastComma = raw.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const dotIsDecimal = lastDot > lastComma;
    const group = dotIsDecimal ? /,/g : /\./g;
    const at = dotIsDecimal ? lastDot : lastComma;
    return `${raw.slice(0, at).replace(group, "")}.${raw.slice(at + 1).replace(group, "")}`;
  }
  // The same mark twice reads as grouping, but only when the groups are
  // actually groups — "1.234.567" is a pasted number, "1.2.3" is a slip of
  // the finger and falls through to the cleanup below.
  if (GROUPED.test(raw)) return raw.replace(/[.,]/g, "");
  return raw.replace(/,/g, ".");
}

export function sanitizeAmount(raw: string): string | null {
  const s = normalizeMarks(raw);
  if (s === "" || AMOUNT_REGEX.test(s)) return s === "." ? "0." : s;
  // Paste path: strip whatever is left that is neither digit nor mark.
  const cleaned = s.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
  if (cleaned !== "" && AMOUNT_REGEX.test(cleaned)) return cleaned;
  return null;
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
        const next = sanitizeAmount(e.target.value);
        if (next !== null) onChange(next);
      }}
      placeholder={placeholder}
      aria-label={ariaLabel}
      className={className}
      style={style}
      disabled={disabled}
    />
  );
}
