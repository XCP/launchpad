import type { WithheldReason } from "@/lib/positions";

/**
 * What to tell someone staring at a dash.
 *
 * `short` sits under the dash in grey, so the reason is legible without
 * hovering anything — the old `title` attribute was unreachable on a phone and
 * easy to miss on a desktop. `full` is the sentence behind it for a tooltip or
 * a caption. Written in the second person and in terms of what happened to the
 * tokens, not in terms of this app's data model: "sent or received elsewhere"
 * is something a holder can recognise, "history doesn't reconcile" is not.
 */
export const WITHHELD_COPY: Record<WithheldReason, { short: string; full: string }> = {
  untracked: {
    short: "not minted or traded here",
    full: "You hold this token, but xcp.fun has no mint or trade of it for this address — so there is no cost to measure a profit against.",
  },
  unpriced: {
    short: "arrived without a price",
    full: "These tokens came in by transfer at a moment with no pool price to value them, so what they cost you is unknown.",
  },
  unreconciled: {
    short: "moved outside xcp.fun",
    full: "Your on-chain balance does not match the mints and trades tracked here, so tokens were sent or received somewhere this page cannot see. The balance is right; the profit cannot be worked out from it.",
  },
};
