import type { Metadata } from "next";
import { MempoolView } from "@/app/mempool/_components/mempool-view";

export const metadata: Metadata = {
  title: "Mempool — xcp.fun",
  description:
    "XCP-69 launches and mints sitting in the Bitcoin mempool, not yet confirmed.",
};

/* No revalidate directive on purpose, which is the opposite of what used to be
 * here. `export const revalidate = 0` opts a route into DYNAMIC rendering —
 * re-rendered per request, never cached — and it was written to express "a
 * cached render of a mempool would be a contradiction". But nothing on this
 * page is rendered from mempool data: MempoolView is a client component that
 * polls for everything, and this file fetches nothing. So the directive bought
 * a server render per visitor of a shell that is identical every time, which
 * is exactly the cost that matters when a launch brings a surge of them.
 *
 * With no directive the shell is prerendered and served from cache, and the
 * mempool stays as live as it ever was — the client's poll is what makes it
 * live, and that is untouched. */

/**
 * What's queued but not yet confirmed.
 *
 * The one question the site couldn't answer without a block explorer open
 * beside it: has anyone else already sent the transaction I'm about to send?
 *
 * Only the mints this site has an opinion about are counted — a mint against
 * some non-conforming fairminter is a real Counterparty transaction and none
 * of xcp.fun's business. That filtering lives in useMempool rather than here,
 * because the header chip needs the identical answer and a badge that
 * contradicts the page one tap away is worse than no badge.
 */
export default function MempoolPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <MempoolView />
    </div>
  );
}
