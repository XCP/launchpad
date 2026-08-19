/**
 * Post-deploy smoke test, run against the DEPLOYED worker.
 *
 * This exists because of a single day's bugs, every one of which passed tsc,
 * eslint and the whole unit suite, and every one of which was live in
 * production:
 *
 *   - every cached read route returned 500 on the second request for a URL,
 *     because a `cache-control` header was being set on an immutable Response
 *   - /ws/presence and /ws/launches answered 500 for the same reason, so the
 *     presence badge and every live launch room had been dead for a day
 *   - Cloudflare rewrote `max-age` on cache hits to a zone default of four
 *     hours, so a 60s poll was really a four-hour one
 *   - a launch room sent nothing until its next 15s tick, so a page showed
 *     stale numbers for up to fifteen seconds after loading
 *
 * The unit suite could not have caught any of them: vitest.config.mts covers
 * "the pure layers only", deliberately, and these are all integration
 * failures. What they have in common is that the FIRST request looks fine.
 * You only see them by asking twice, by opening a socket, or by reading the
 * headers that come back — which is exactly what this does.
 *
 * Not a test of correctness. It does not care what the numbers say; it cares
 * that the routes answer, keep answering, and answer with what they promised.
 *
 *   node scripts/smoke.mjs [baseUrl]
 *
 * Exits non-zero on the first failure that matters, so it can gate a deploy.
 */

const BASE = (process.argv[2] ?? "https://api.xcp.fun").replace(/\/$/, "");
const WS_BASE = BASE.replace(/^http/, "ws");

/**
 * A crash must never read as a pass.
 *
 * The first version of this file exited 0 while dying on an uncaught error,
 * which is the one failure mode a deploy gate cannot have — it would wave
 * through exactly the broken deploy it exists to stop. Anything that escapes
 * a check lands here and fails the run.
 */
for (const signal of ["uncaughtException", "unhandledRejection"]) {
  process.on(signal, (err) => {
    console.error(`\nsmoke: ${signal} — treating as failure\n`, err);
    process.exit(1);
  });
}

let failures = 0;
const pass = (name, detail = "") => console.log(`  PASS  ${name}${detail ? `  ${detail}` : ""}`);
const fail = (name, detail) => {
  failures++;
  console.log(`  FAIL  ${name}\n        ${detail}`);
};

async function check(name, fn) {
  try {
    const detail = await fn();
    pass(name, detail ?? "");
  } catch (err) {
    fail(name, err instanceof Error ? err.message : String(err));
  }
}

/** Read a response fully, plus the headers this cares about. */
async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  const body = await res.text();
  return {
    status: res.status,
    body,
    cacheControl: res.headers.get("cache-control"),
    cfCache: res.headers.get("cf-cache-status"),
    tao: res.headers.get("timing-allow-origin"),
  };
}

const maxAge = (control) => {
  const m = /max-age=(\d+)/.exec(control ?? "");
  return m ? Number(m[1]) : null;
};

/**
 * Open a socket and resolve with how long the FIRST frame took.
 *
 * Settled exactly once, by a flag rather than by trusting the events to
 * arrive in a sensible order. They do not: a socket that fails to connect
 * fires `error` and then `close`, and calling `close()` from inside the
 * `error` handler fires `error` AGAIN — which recursed until the stack blew
 * and took the whole process down with it, reporting exit 0 while failing.
 * Nothing here closes a socket it has not seen open.
 */
function firstFrameMs(url, timeoutMs = 12_000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let settled = false;
    let opened = false;
    let socket;

    const done = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (opened) {
        try {
          socket.close();
        } catch {
          // A socket already tearing itself down; nothing to do about it.
        }
      }
      fn(value);
    };

    const timer = setTimeout(
      () => done(reject, new Error(`no frame within ${timeoutMs}ms`)),
      timeoutMs,
    );

    try {
      socket = new WebSocket(url);
    } catch (err) {
      done(reject, err instanceof Error ? err : new Error(String(err)));
      return;
    }

    socket.onopen = () => {
      opened = true;
    };
    socket.onmessage = () => done(resolve, Date.now() - started);
    socket.onerror = () => done(reject, new Error("socket error — the upgrade did not complete"));
    socket.onclose = (event) =>
      done(reject, new Error(`closed before any frame (code ${event.code})`));
  });
}

console.log(`\nsmoke: ${BASE}\n`);

// --- the routes answer at all --------------------------------------------
await check("health responds", async () => {
  const r = await get("/health");
  if (r.status !== 200) throw new Error(`expected 200, got ${r.status}`);
});

// --- a cached route survives being asked twice ---------------------------
// The bug this catches returned a correct 200 to the first caller and a 21
// byte "Internal Server Error" to everyone after, for the whole TTL.
for (const path of ["/v2/launches?phase=minting&limit=4", "/v2/stats?height=0", "/v2/mempool"]) {
  await check(`repeat request: ${path.split("?")[0]}`, async () => {
    const cold = await get(path);
    if (cold.status !== 200) throw new Error(`first request was ${cold.status}`);
    const warm = await get(path);
    if (warm.status !== 200) {
      throw new Error(
        `first request 200, second was ${warm.status} ` +
          `(cf-cache-status: ${warm.cfCache}) — a cache hit is not being served correctly`,
      );
    }
    if (warm.body !== cold.body) {
      // Not necessarily wrong — a route with a live value can legitimately
      // differ between two calls — so this reports rather than fails.
      return `(bodies differ, ${cold.body.length}b then ${warm.body.length}b)`;
    }
    return `2x200, ${cold.body.length}b`;
  });
}

// --- the TTL the route asked for is the TTL that comes back --------------
// Cloudflare rewrites max-age on anything it serves from cache to the zone's
// Browser Cache TTL. Set to a default four hours, a polled route silently
// becomes uncacheable-by-poll: the browser answers from its own store and the
// poll never reaches us.
await check("cache hit keeps the route's own max-age", async () => {
  const path = "/v2/launches?phase=minting&limit=4";
  const cold = await get(path);
  const warm = await get(path);
  const a = maxAge(cold.cacheControl);
  const b = maxAge(warm.cacheControl);
  if (a === null) throw new Error(`no max-age on the response at all: ${cold.cacheControl}`);
  if (a !== b) {
    throw new Error(
      `route asked for max-age=${a}, a cache hit returned max-age=${b} — ` +
        `check Browser Cache TTL on the zone (should be "Respect Existing Headers")`,
    );
  }
  return `max-age=${a} both cold and warm`;
});

// --- the measurement header actually lands -------------------------------
// It threw on immutable responses rather than being skipped, which is what
// took the whole route down. Its presence is the cheap proof it no longer can.
await check("Timing-Allow-Origin present on a cache hit", async () => {
  const path = "/v2/stats?height=0";
  await get(path);
  const warm = await get(path);
  if (warm.tao !== "*") throw new Error(`expected "*", got ${warm.tao}`);
});

// --- the crown travels with the minting page -----------------------------
await check("minting page carries a king, other phases do not", async () => {
  const minting = JSON.parse((await get("/v2/launches?phase=minting&limit=4")).body);
  const scheduled = JSON.parse((await get("/v2/launches?phase=scheduled&limit=4")).body);
  if (scheduled.king != null) throw new Error("scheduled returned a king; only minting has one");
  if (!Array.isArray(minting.result)) throw new Error("minting returned no result array");
  // A king is only absent when nothing has ever minted, which is a real state
  // and not a failure — so this reports it rather than failing on it.
  return minting.king ? `king=${minting.king.asset}` : "(no launch has minted yet)";
});

// --- the websockets complete their upgrade -------------------------------
// These answered 500 for a day without anyone noticing, because a socket that
// never opens looks exactly like a socket with nothing to say.
await check("/ws/presence upgrades and reports", async () => {
  const ms = await firstFrameMs(`${WS_BASE}/ws/presence`);
  return `first frame ${ms}ms`;
});

await check("/ws/launches upgrades and replays on connect", async () => {
  const page = JSON.parse((await get("/v2/launches?phase=minting&limit=1")).body);
  const row = page.result?.[0];
  if (!row) return "(no minting launch to open a room for)";
  const url = `${WS_BASE}/ws/launches/${encodeURIComponent(row.asset)}?fm=${encodeURIComponent(row.tx_hash)}`;

  // Twice, deliberately. The first connection warms the room; the second is
  // the one under test, because the regression being guarded is that a room
  // says NOTHING to a new socket until its next 15s tick. A warm room must
  // hand over what it already knows immediately, so a slow second frame here
  // means the replay is gone even though the socket itself is fine.
  await firstFrameMs(url);
  const ms = await firstFrameMs(url, 5_000);
  if (ms > 3_000) {
    throw new Error(`warm room took ${ms}ms to send its first frame — replay-on-connect is not working`);
  }
  return `warm room replied in ${ms}ms`;
});

console.log(
  failures === 0
    ? "\nsmoke: all checks passed\n"
    : `\nsmoke: ${failures} check${failures === 1 ? "" : "s"} FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
