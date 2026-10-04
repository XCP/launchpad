import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { apiReplayDb } from "./helpers/api-replay-db";
import fixture from "./fixtures/fewgoodman-index-recovery.json";

let database: ReturnType<typeof apiReplayDb>;
beforeEach(() => { vi.resetModules(); database = apiReplayDb(); });
afterEach(() => { database.raw.close(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("fences the original anchor when a descendant lands or node status lags", async () => {
  database.raw.exec("INSERT INTO indexed_blocks(block_index,block_hash,ledger_hash,messages_hash) VALUES(100,'a100','l100','m100')");
  let replaced = false;
  vi.stubGlobal("fetch", async (input:string) => {
    const url = new URL(input);
    const h = Number(url.searchParams.get("cursor") ?? 101);
    return Response.json({result:[{block_index:h,block_hash:replaced?'fork':`a${h}`,ledger_hash:`l${h}`,messages_hash:`m${h}`} ]});
  });
  const {verifyLedgerTip} = await import("#api/indexer/ledger");
  await expect(verifyLedgerTip(database.db,100)).resolves.toBeUndefined();
  replaced = true;
  await expect(verifyLedgerTip(database.db,100)).rejects.toThrow("Chain changed");
});

it("does not erase graduates or reload unaffected historic mints on repeated recovery", async () => {
  const columns = new Set(database.raw.prepare("PRAGMA table_xinfo(launches)").all().filter(c=>c.hidden===0).map(c=>c.name));
  const entries = Object.entries({...fixture.launch,status:'closed',phase:'graduated',earned_quantity:'6900000000000000'}).filter(([k])=>columns.has(k));
  database.raw.prepare(`INSERT INTO launches(${entries.map(([k])=>k).join(',')}) VALUES(${entries.map(()=>'?').join(',')})`).run(...entries.map(([,v])=>typeof v==='boolean'?Number(v):v));
  const before = database.raw.prepare("SELECT phase,earned_quantity,pool_xcp_reserve,pool_token_reserve FROM launches").get();
  const {rollbackIndexTo} = await import("#api/indexer/ledger");
  await rollbackIndexTo(database.db,969885);
  await rollbackIndexTo(database.db,969885);
  expect(database.raw.prepare("SELECT phase,earned_quantity,pool_xcp_reserve,pool_token_reserve FROM launches").get()).toEqual(before);
  expect(database.raw.prepare("SELECT value FROM chain_state WHERE key='ledger_recovery'").get()).toEqual({value:'969885'});
});

it("revisits its retained checkpoint after downtime moves the fork outside the rolling window", async () => {
  let tip = 100;
  let forked = false;
  const cache = new Map<string, unknown>();
  const heights: number[] = [];
  vi.stubGlobal("fetch", async (input: string) => {
    const url = new URL(input);
    const top = Number(url.searchParams.get("cursor") ?? tip);
    heights.push(top);
    if (!cache.has(input)) cache.set(input, {
      result: Array.from({ length: Math.min(Number(url.searchParams.get("limit")), top) }, (_, i) => {
        const h = top - i;
        // Consensus hashes alone need not identify an empty Bitcoin fork.
        return { block_index: h, block_hash: `${forked && h >= 98 ? "b" : "a"}${h}`, ledger_hash: `l${h}`, messages_hash: `m${h}` };
      }),
    });
    return Response.json(cache.get(input));
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const { checkLedger } = await import("#api/indexer/ledger");
  await checkLedger(database.db);
  tip = 200; forked = true;
  expect(await checkLedger(database.db)).toMatchObject({ rolled_back_to: 97, fork_below_window: false });
  expect(heights).toContain(100);
  expect(database.raw.prepare("SELECT value FROM chain_state WHERE key='ledger_recovery'").get()).toEqual({ value: "97" });
  // A restart cannot forget pending derived-state repair just because the
  // replacement hashes are already recorded.
  expect(await checkLedger(database.db)).toMatchObject({ rolled_back_to: 97 });
});

it("refuses to guess an ancestor when every retained block differs", async () => {
  database.raw.exec("INSERT INTO indexed_blocks(block_index,ledger_hash,block_hash) VALUES(100,'old','old')");
  vi.stubGlobal("fetch", async (input: string) => {
    const url = new URL(input);
    const top = Number(url.searchParams.get("cursor") ?? 100);
    return Response.json({ result: Array.from({length:12},(_,i)=>({block_index:top-i,block_hash:"new",ledger_hash:"new",messages_hash:null})) });
  });
  const { checkLedger } = await import("#api/indexer/ledger");
  await expect(checkLedger(database.db)).rejects.toThrow("No verified common ancestor");
  expect(database.raw.prepare("SELECT ledger_hash FROM indexed_blocks").get()).toEqual({ ledger_hash: "old" });
});

it("replaces a full order snapshot, including absence and re-mined inclusion fields", async () => {
  const order = (hash: string) => ({tx_hash:hash,tx_index:1,block_index:100,source:"alice",give_asset:"AAA",get_asset:"XCP",
    give_quantity:100,get_quantity:200,give_remaining:80,get_remaining:160,status:"open",expiration:0,expire_index:null});
  let book = [order("a"),order("b")];
  const cache = new Map<string, unknown>();
  vi.stubGlobal("fetch", async (input:string) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/blocks")) return Response.json({result:[{block_index:102,block_hash:"a102",ledger_hash:"l102",messages_hash:null}]});
    if (!cache.has(input)) cache.set(input,{result:structuredClone(book),next_cursor:null});
    return Response.json(cache.get(input));
  });
  const {syncOrders} = await import("#api/indexer/orders");
  await syncOrders(database.db,["AAA"]);
  book = [{...order("a"),block_index:101,tx_index:2}];
  database.raw.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON orders BEGIN SELECT RAISE(ABORT,'interrupted'); END");
  await expect(syncOrders(database.db,["AAA"])).rejects.toThrow("interrupted");
  database.raw.exec("DROP TRIGGER fail_delete");
  await syncOrders(database.db,["AAA"]);
  expect(database.raw.prepare("SELECT tx_hash,tx_index,block_index,expire_index,token_remaining FROM orders").all())
    .toEqual([{tx_hash:"a",tx_index:2,block_index:101,expire_index:null,token_remaining:"80"}]);
  expect(await syncOrders(database.db,["AAA"])).toMatchObject({markets_changed:0,rows_written:0});
  book=[];
  await syncOrders(database.db,["AAA"]);
  expect(database.raw.prepare("SELECT COUNT(*) n FROM orders").get()).toEqual({n:0});
});

it("does not acknowledge a book whose tip changed between pages", async () => {
  let reads=0;
  vi.stubGlobal("fetch",async(input:string)=>{
    if(new URL(input).pathname.endsWith("/blocks")) return Response.json({result:[{block_index:100,block_hash:++reads===1?"a":"b",ledger_hash:"l",messages_hash:null}]});
    return Response.json({result:[],next_cursor:null});
  });
  const {syncOrders}=await import("#api/indexer/orders");
  await expect(syncOrders(database.db,["AAA"])).rejects.toThrow("Chain changed");
  expect(database.raw.prepare("SELECT COUNT(*) n FROM chain_state WHERE key LIKE 'orders_digest:%'").get()).toEqual({n:0});
});

it("repairs orphan trades committed before their cursor and allows a shorter verified height", async () => {
  database.raw.exec(`INSERT INTO asset_events(id,event,address,asset,block_index,token_delta,xcp_delta,kind)
    VALUES('orphan','event','alice','AAA',101,'1','-1','buy');
    INSERT INTO price_candles(id,asset,resolution,bucket_start,open,high,low,close,volume_xcp,trades,last_block)
    VALUES('candle','AAA','1d',0,'1','1','1','1','1',1,101);`);
  const {recordBlockHeight,storedBlockHeight}=await import("#api/indexer/height");
  await recordBlockHeight(database.db,101);
  const {rollbackIndexTo}=await import("#api/indexer/ledger");
  expect(await rollbackIndexTo(database.db,100)).toMatchObject({event_assets_reset:1});
  expect(database.raw.prepare("SELECT COUNT(*) n FROM price_candles").get()).toEqual({n:0});
  await recordBlockHeight(database.db,99);
  expect(await storedBlockHeight(database.db)).toBe(99);
});
