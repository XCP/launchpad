import type { Metadata } from "next";
import { fetchIndexedLaunches } from "@/lib/api/launchpad-api";
import { MempoolView } from "@/app/mempool/_components/mempool-view";

export const metadata: Metadata = {
  title: "Mempool — xcp.fun",
  description:
    "XCP-69 launches and mints sitting in the Bitcoin mempool, not yet confirmed.",
};

/** The page shell is static; everything on it is polled by the client. A
 *  cached render of a mempool would be a contradiction. */
export const revalidate = 0;

/** Enough to name every conforming asset — this is a membership test, not a
 *  listing, so it wants the whole set rather than a page of it. */
const ALL_PHASES = 500;

/**
 * What's queued but not yet confirmed.
 *
 * The one question the site couldn't answer without a block explorer open
 * beside it: has anyone else already sent the transaction I'm about to send?
 *
 * Only the mints this site has an opinion about are counted. A mint against
 * some non-conforming fairminter is a real Counterparty transaction and none
 * of xcp.fun's business, so the conforming asset set is resolved server-side
 * and the client filters against it — the same editorial line the rest of the
 * site draws, applied a block earlier than usual.
 */
export default async function MempoolPage() {
  const indexed = await fetchIndexedLaunches(ALL_PHASES);
  const conformingAssets = (indexed ?? []).map((l) => l.fm.asset);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-bold">Mempool</h1>

      <MempoolView conformingAssets={conformingAssets} />
    </div>
  );
}
