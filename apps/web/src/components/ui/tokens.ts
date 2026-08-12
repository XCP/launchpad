/**
 * Class strings that encode a site-wide convention rather than one
 * component's styling. A token here is a decision made once; the same string
 * pasted into nine files is nine chances to drift.
 */

/** The site's uppercase micro-label, above a stat or beside a field. */
export const LABEL = "text-[11px] font-medium uppercase tracking-wider text-gray-500";

/** Keyboard users need to see where they are; nothing else provides this. */
export const FOCUS =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-500";
