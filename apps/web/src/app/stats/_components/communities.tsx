import { CollectionChip } from "@/components/collection-chip";
import { collectionByTag } from "@/lib/collections";
import type { Communities } from "@/lib/api/launchpad-api";
import { commas } from "@/lib/format";
import { big } from "@/lib/numeric";
import { LABEL } from "@/components/ui/tokens";
import { Stat } from "@/app/stats/_components/stat";

const TH = "px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400";

/** Whole-percent share of `part` in `whole`, exact in bigint, null when there is no whole. */
function percent(part: string | undefined, whole: string | undefined): number | null {
  if (part === undefined || whole === undefined) return null;
  const total = big(whole);
  if (total <= 0n) return null;
  return Number((big(part) * 100n) / total);
}

/**
 * Which Counterparty communities the minters come from. One row per
 * collection: creators, collectors, the share of all minters that is either,
 * and the share of all XCP minted that its members put in.
 */
export function CommunitiesSection({ data }: { data: Communities }) {
  const rows = data.communities.filter((row) => row.members > 0);
  if (rows.length === 0 || data.minters === 0) return null;
  const widest = rows[0]?.members ?? 1;
  return (
    <section>
      <h2 className={`mb-1 ${LABEL}`}>Communities</h2>
      <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
        Which Counterparty collections the minters come from. Creators made a card there; collectors hold one.
      </p>
      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Represented"
          value={commas(data.represented)}
          hint={`of ${commas(data.minters)} minters, ${Math.round((data.represented / data.minters) * 100)}%`}
        />
        <Stat label="Communities" value={commas(rows.length)} hint="collections with a minter in them" />
        <Stat label="Creators" value={commas(data.creators ?? 0)} hint="made a card in one" />
        <Stat label="Collectors" value={commas(data.collectors ?? 0)} hint="hold one, made none" />
      </div>
      <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-gray-100 dark:border-gray-800 text-left">
              <th className={`${TH} pl-4`} colSpan={2}>
                Community
              </th>
              <th className={`${TH} text-right`}>Creators</th>
              <th className={`${TH} text-right`}>Collectors</th>
              <th className={TH}>Of minters</th>
              <th className={`${TH} pr-4 text-right`} title="Share of all XCP committed to mints that came from this community's members">
                Of XCP minted
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {rows.map((row) => {
              const collection = collectionByTag(row.tag);
              const name = collection?.name ?? row.tag;
              const pct = Math.round((row.members / data.minters) * 100);
              const paidPct = percent(row.paid_xcp, data.paid_xcp);
              return (
                <tr key={row.tag} className="tabular-nums">
                  <td className="w-10 pl-4 py-2">
                    {collection ? <CollectionChip collection={collection} title={collection.name} /> : null}
                  </td>
                  <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100" title={row.tag}>
                    {name}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{commas(row.creators)}</td>
                  <td className="px-3 py-2 text-right text-gray-600 dark:text-gray-400">{commas(row.collectors)}</td>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                      <span
                        className="h-1.5 w-24 shrink-0 rounded-full bg-gray-100 dark:bg-gray-800"
                        title={`${row.members} of ${data.minters} minters`}
                      >
                        <span
                          className="block h-1.5 rounded-full bg-purple-400 dark:bg-purple-500"
                          style={{ width: `${Math.max(2, (row.members / widest) * 100)}%` }}
                        />
                      </span>
                      <span className="w-8 text-right">{pct}%</span>
                    </span>
                  </td>
                  <td className="pr-4 py-2 text-right text-gray-600 dark:text-gray-400">
                    {paidPct === null ? <span aria-hidden="true">—</span> : `${paidPct}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
