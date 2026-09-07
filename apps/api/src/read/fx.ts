import { fetchFxRates } from "#api/integrations/fx";
import { J, router } from "#api/read/respond";

export const fxRoute = router();

/**
 * USD → other currencies, for the browser's currency switch.
 *
 * The upstream is the ECB's daily table, which changes once a business day,
 * so an hour at the edge is conservative. A visitor only asks for this when
 * they are not in dollars, and the browser keeps the answer for half a day
 * on top of the edge cache, so this is a handful of origin requests a day
 * in total. Never cached on failure: a 503 here means dollars for one page
 * view, not for an hour.
 */
fxRoute.get("/v2/fx", async (c) => {
  const result = await fetchFxRates();
  if (!result) return c.json({ error: "fx unavailable" }, 503);
  return J(c, { result }, 3_600);
});
