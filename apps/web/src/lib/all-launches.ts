import { fetchLaunchPage, type IndexedPage } from "@/lib/api/launchpad-api";
import { type LaunchPage, toSectionRow } from "@/lib/launch-row";
import type { LaunchPhase } from "@/lib/xcp69";

export const ALL_LAUNCHES_PAGE_SIZE = 200;

// The public API still caps each request at 100 and its offset at 100,000.
// Split the view instead of letting that cap silently discard half a page.
const API_PAGE_SIZE = 100;
const API_MAX_OFFSET = 100_000;

/** One directory page, using only the existing launch index. Failure rejects the
 *  whole read so SWR can retain the last complete page. The API has no shared
 *  snapshot revision; these checks detect incomplete or conflicting chunks,
 *  but cannot make two offset reads a single database snapshot. */
export async function fetchAllLaunchesPage(
  phase: LaunchPhase,
  sort: string,
  pageIndex: number,
  tip?: number,
  unmintedBy?: string,
): Promise<LaunchPage> {
  const offset = pageIndex * ALL_LAUNCHES_PAGE_SIZE;
  if (!Number.isSafeInteger(pageIndex) || pageIndex < 0 || offset > API_MAX_OFFSET) {
    throw new Error("all_launches_invalid_page");
  }

  const seen = new Set<string>();
  const readChunk = async (at: number, total?: number): Promise<IndexedPage> => {
    if (at > API_MAX_OFFSET) throw new Error("all_launches_invalid_page");
    const chunk = await fetchLaunchPage(phase, sort, API_PAGE_SIZE, at, unmintedBy, tip);
    if (!chunk) throw new Error("all_launches_unavailable");
    if (
      !Number.isSafeInteger(chunk.total) || chunk.total < 0 ||
      (total !== undefined && chunk.total !== total)
    ) {
      throw new Error("all_launches_inconsistent_total");
    }
    const expected = Math.min(API_PAGE_SIZE, Math.max(0, chunk.total - at));
    if (chunk.rows.length !== expected) throw new Error("all_launches_incomplete");
    for (const row of chunk.rows) {
      const id = row.fm.tx_hash;
      if (row.phase !== phase || typeof id !== "string" || !id || seen.has(id)) {
        throw new Error("all_launches_inconsistent_rows");
      }
      seen.add(id);
    }
    return chunk;
  };

  const first = await readChunk(offset);
  const rows = [...first.rows];
  const expected = Math.min(ALL_LAUNCHES_PAGE_SIZE, Math.max(0, first.total - offset));
  if (expected > API_PAGE_SIZE) {
    const second = await readChunk(offset + API_PAGE_SIZE, first.total);
    rows.push(...second.rows);
  }
  if (rows.length !== expected) throw new Error("all_launches_incomplete");
  if (first.king && first.king.phase !== phase) {
    throw new Error("all_launches_inconsistent_rows");
  }
  return {
    rows: rows.map(toSectionRow),
    total: first.total,
    king: first.king ? toSectionRow(first.king) : null,
  };
}
