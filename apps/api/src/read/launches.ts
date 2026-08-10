import { getLaunch, listLaunches, listMinters, sumFees } from "#api/queries/launches";
import { J, router } from "./respond";

export const launchesRoute = router();

launchesRoute.get("/v2/launches", async (c) => {
  const perPhase = Math.min(Number(c.req.query("per_phase") ?? 12) || 12, 50);
  const result = await listLaunches(c.env.DB, perPhase);
  return J(c, { result, result_count: result.length }, 60);
});

launchesRoute.get("/v2/launches/:asset", async (c) => {
  const asset = c.req.param("asset").toUpperCase();
  const result = await getLaunch(c.env.DB, asset);
  if (!result) return J(c, { result: null }, 15);
  return J(c, { result }, 15);
});

launchesRoute.get("/v2/launches/:asset/minters", async (c) => {
  const asset = c.req.param("asset").toUpperCase();
  const launch = await getLaunch(c.env.DB, asset);
  if (!launch) return J(c, { result: [] }, 15);
  const limit = Math.min(Number(c.req.query("limit") ?? 200) || 200, 1000);
  const result = await listMinters(c.env.DB, launch.tx_hash, limit);
  return J(c, { result, result_count: result.length }, 15);
});

launchesRoute.get("/v2/launches/:asset/fees", async (c) => {
  const asset = c.req.param("asset").toUpperCase();
  const launch = await getLaunch(c.env.DB, asset);
  if (!launch) return J(c, { result: null }, 15);
  const result = await sumFees(c.env.DB, launch.tx_hash);
  return J(c, { result }, 15);
});
