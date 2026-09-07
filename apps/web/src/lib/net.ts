/**
 * The two rules a Cloudflare Worker has to follow when it talks to the network,
 * in one place because forgetting either one is invisible until production.
 *
 * A Worker may hold only six outbound connections open at once. A `Response`
 * whose body is never read and never cancelled keeps its slot until garbage
 * collection, which may be long after the render that made it has finished. Do
 * that on an error path — `if (!res.ok) return null` is the usual shape — and a
 * struggling upstream turns every failed read into a leaked slot. Past six, the
 * runtime cancels the oldest in-flight response to avoid deadlock and logs
 * "A stalled HTTP response was canceled to prevent deadlock". The cancelled
 * response belongs to some other, innocent request, so the symptom never points
 * at the code that caused it.
 *
 * The second rule follows from the first: a `Promise.all` over a data-driven
 * list issues one subrequest per element at once. Six is the budget however
 * many you ask for, so an uncapped fan-out spends the whole render fighting
 * itself. Waves of a fixed size finish sooner and leave room for the rest of
 * the page.
 */

/**
 * Let go of a response we are not going to read.
 *
 * Call it on every path that abandons a `Response` — before a `throw`, before
 * `return null`, before falling through to a second attempt. Cancelling is
 * cheap and releases the connection immediately, where dropping the reference
 * releases it whenever the collector next runs.
 *
 * Never throws: this is cleanup on a path that already failed, and a failure to
 * cancel must not replace the error the caller is actually reporting.
 */
export async function discard(response: Response | null | undefined): Promise<void> {
  try {
    await response?.body?.cancel();
  } catch {
    // Already cancelled, already consumed, or never had a body. Nothing owed.
  }
}

/**
 * `Promise.all(items.map(fn))` with a ceiling on how many run at once.
 *
 * Results keep the order of `items`, so callers can zip them back against their
 * inputs exactly as they did before. `limit` defaults to four rather than the
 * platform's six: a server render is rarely the only thing in flight, and
 * leaving headroom is what keeps one page's fan-out from cancelling another's.
 *
 * A rejection propagates, as it would from `Promise.all` — this bounds
 * concurrency, it does not change error handling. Callers that would rather
 * tolerate partial failure should catch inside `fn` and return a sentinel,
 * which is what most of the callers here already do.
 */
export async function mapWithLimit<T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => Promise<R>,
  limit = 4,
): Promise<R[]> {
  if (items.length === 0) return [];
  const ceiling = Math.max(1, Math.min(limit, items.length));
  const results = new Array<R>(items.length);
  let next = 0;

  // Each worker pulls the next index until the list is exhausted, so a slow
  // element delays only itself. Slicing into fixed chunks would instead make
  // every chunk wait for its slowest member.
  const workers = Array.from({ length: ceiling }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!, index);
    }
  });

  await Promise.all(workers);
  return results;
}
