/** Core caches by URL across rollbacks. Its scalar arguments and verbose
 * enrichment use the first value; the second value only changes the cache key.
 * Keep pagination, limits and enrichment identical on every attempt. */
export function freshCounterpartyUrl(input: string): string {
  const url = new URL(input);
  if (url.pathname.endsWith("/v2/")) return input;
  const verbose = url.searchParams.get("verbose") ?? "false";
  url.searchParams.delete("verbose");
  url.searchParams.append("verbose", verbose);
  url.searchParams.append("verbose", crypto.randomUUID());
  return url.toString();
}
