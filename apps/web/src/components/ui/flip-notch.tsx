"use client";

/**
 * The direction-flip button straddling the seam between two wells: a
 * squircle in the well color with a ring in the card color punching
 * through, rotating 180° per flip.
 *
 * Centering and rotation live on SEPARATE elements. Tailwind v4's
 * translate utilities set the CSS `translate` property, which composes
 * with (not replaced by) an inline `transform` — putting the -50%
 * centering in both places double-shifted the button off center. The
 * button centers via classes alone; only the inner icon rotates.
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
        className="absolute left-1/2 top-1/2 flex size-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-2xl bg-gray-50 dark:bg-gray-800/60 text-gray-500 dark:text-gray-400 shadow-[0_0_0_4px_white] hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-purple-600 dark:hover:text-purple-400 active:scale-95"
      >
        <span
          className="inline-flex transition-transform duration-300"
          style={{ transform: `rotate(${flips * 180}deg)` }}
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-4"
          >
            <path d="M8 3v10M4 9l4 4 4-4" />
          </svg>
        </span>
      </button>
    </div>
  );
}
