/**
 * The amber "something is queued" dot.
 *
 * Extracted from MempoolChip so the header and the launch cards cannot drift:
 * they are reporting the same fact from the same poll, and two copies of the
 * markup is how one of them quietly becomes a different colour or stops
 * pulsing. Purely decorative — every caller puts the number in text beside it,
 * so nothing here needs announcing to a screen reader.
 */
export function PendingDot() {
  return (
    <span aria-hidden className="relative flex size-1.5 shrink-0">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-amber-400 opacity-75" />
      <span className="relative inline-flex size-1.5 rounded-full bg-amber-500" />
    </span>
  );
}
