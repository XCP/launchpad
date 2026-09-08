# Launch directory

The homepage shows first-page previews. Each section ends in a View all link with the full phase count, including when Hide minted filters the preview. Sorting still queries the whole phase before taking its preview. Existing preview sizes and minting Crown behavior are retained.

## Routes and presentation

- /graduated, /minting, /scheduled, and /graveyard share one directory view. Non-English routes use the normal locale prefix.
- /all permanently redirects to /graduated. Older phase query links redirect to the corresponding path; valid display preferences survive.
- Homepage links carry sort, table/grid, and fiat/XCP denomination. Tabs retain display choices and reset to the new phase's default sort. Directory sort and view controls update the URL; language changes preserve those query values.
- The directory reuses HomeToolbar (search, market prices, Create). Every phase has the same sort and grid/table controls. Its desktop sort and first card positions match the homepage.
- Asset status badges link to their phase. The classic non-pool Minted out fallback remains a status label.
- Each phase has its own canonical/hreflang metadata. The sitemap lists the four phase routes, not the redirect. Graveyard is part of the public directory.

## Request and data contract

A directory page holds up to 200 launches. The existing API limit is 100, so the reader makes one or two sequential requests for the selected phase. It verifies exact expected lengths, matching totals, phase, unique transaction hashes, and supported offsets. Partial or contradictory results fail the whole refresh; the last complete page is retained. The API does not offer a shared snapshot version, so offset reads cannot prove an atomic database snapshot.

One five-minute aggregate supplies all four tab counts without fetching four lists. The visible page's own total controls its count and pagination. A shrinking phase refetches the last valid page instead of restoring an older cached slice.

The directory uses indexed minter counts rather than per-asset holder lookups. No full-chain derivation is added. Launch lists refresh every minute; the mempool hook shares its existing cache with the header. One shared market snapshot supplies both prices and reference dates, with minute deduplication across phase navigation. Search reads the index only when opened.

Unknown chain height leaves height-derived times and recent-return windows blank until a valid tip arrives. Mint Pace requests still require a valid height. No form parsing, raw quantities, compose calls, or signing behavior changes.
