import { LazyLink } from "@/components/lazy-link";
import { CollectionChip } from "@/components/collection-chip";
import { collectionByTag } from "@/lib/collections";
import type { Communities } from "@/lib/api/launchpad-api";
import { commas } from "@/lib/format";
import { LABEL } from "@/components/ui/tokens";

/**
 * Which Counterparty communities the minters come from. One row per
 * collection: creators, collectors, the share of all minters that is either,
 * and the launch the community is most present in. Collections the site has
 * no chip for are listed by name; the explorer knows more than the badge set.
 */
export function CommunitiesSection({ data }: { data: Communities }) {
  const rows = data.communities.filter((row) => row.members > 0);
  if (rows.length === 0 || data.minters === 0) return null;
  const widest = rows[0]?.members ?? 1;
  return (
    <section>
      <h2 className={`mb-1 ${LABEL}`}>Communities</h2>
      <p className="mb-3 text-sm text-gray-600 dark:text-gray-400">
        {commas(data.represented)} of {commas(data.minters)} minting addresses created or collect cards in a
        known Counterparty collection. Creators made a card there; collectors hold one.
      </p>
      <ul className="divide-y divide-gray-100 dark:divide-gray-800 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        {rows.map((row) => {
          const collection = collectionByTag(row.tag);
          const name = collection?.name.replace(/ card$/, "") ?? row.tag;
          const pct = Math.round((row.members / data.minters) * 100);
          return (
            <li key={row.tag} className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1 px-4 py-2 text-sm sm:grid-cols-[auto_11rem_1fr_auto]">
              <span className="w-8">
                {collection ? <CollectionChip collection={collection} title={collection.name} /> : null}
              </span>
              <span className="truncate font-medium text-gray-900 dark:text-gray-100" title={row.tag}>
                {name}
              </span>
              <span className="col-span-3 flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 tabular-nums sm:col-span-1">
                <span className="w-24 shrink-0">
                  {row.creators} creator{row.creators === 1 ? "" : "s"}
                </span>
                <span className="w-24 shrink-0">
                  {row.collectors} collector{row.collectors === 1 ? "" : "s"}
                </span>
                <span
                  className="h-1.5 flex-1 rounded-full bg-gray-100 dark:bg-gray-800"
                  title={`${row.members} of ${data.minters} minters (${pct}%)`}
                >
                  <span
                    className="block h-1.5 rounded-full bg-purple-400 dark:bg-purple-500"
                    style={{ width: `${Math.max(2, (row.members / widest) * 100)}%` }}
                  />
                </span>
                <span className="w-9 shrink-0 text-right">{pct}%</span>
              </span>
              <span className="col-start-2 text-xs text-gray-500 dark:text-gray-400 sm:col-start-auto sm:text-right">
                {row.top ? (
                  <>
                    most in{" "}
                    <LazyLink
                      href={`/${row.top.asset}`}
                      className="font-medium text-purple-600 dark:text-purple-400 hover:underline"
                      title={`${row.top.minters} of that launch's minters, ${Math.round(row.top.share * 100)}%`}
                    >
                      {row.top.asset}
                    </LazyLink>{" "}
                    <span className="tabular-nums">({row.top.minters})</span>
                  </>
                ) : (
                  <span aria-hidden="true">—</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
