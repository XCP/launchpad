"use client";

/**
 * The direction-flip button straddling the seam between two wells: a
 * squircle in the well color with a ring in the card color punching
 * through, rotating 180° per flip.
 */
export function FlipNotch({
  onFlip,
  flips,
  label = "Flip direction",
}: {
  onFlip: () => void;
  flips: number;
  label?: string;
}) {
  return (
    <div className="relative z-10 h-0.5">
      <button
        type="button"
        onClick={onFlip}
        aria-label={label}
        title={label}
        className="absolute left-1/2 top-1/2 flex size-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-2xl bg-gray-50 text-gray-500 shadow-[0_0_0_4px_white] transition-transform duration-300 hover:bg-gray-100 hover:text-purple-600 active:scale-95"
        style={{ transform: `translate(-50%, -50%) rotate(${flips * 180}deg)` }}
      >
        ↓
      </button>
    </div>
  );
}
