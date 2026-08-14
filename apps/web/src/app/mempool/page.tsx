import type { Metadata } from "next";
import { MempoolView } from "@/app/mempool/_components/mempool-view";

export const metadata: Metadata = {
  title: "Mempool — xcp.fun",
  description:
    "XCP-69 launches and mints sitting in the Bitcoin mempool, not yet confirmed.",
};

/** The page shell is static; everything on it is polled by the client. A
 *  cached render of a mempool would be a contradiction. */
export const revalidate = 0;

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
