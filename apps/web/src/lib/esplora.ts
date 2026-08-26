"use client";

/**
 * Bitcoin chain reads, from whichever host will answer.
 *
 * Everything the buy flow needs about the user's own coins — what UTXOs they
 * hold, what those add up to, what a transaction costs right now — comes from
 * an Esplora server, and until this file there was exactly one: mempool.space,
 * called directly, with nothing behind it. That is a single point of failure
 * sitting on someone else's DNS record, and it fails in two ways we have
 * actually watched happen:
 *
 *   - It will not answer this client. Rate-limited (users report it "when
 *     trying to do too much from the same address too quickly"), blocked at
 *     the ISP, swallowed by an ad blocker or a DNS filter, or behind the
 *     Great Firewall. These all arrive identically: the fetch throws the
 *     browser's own `TypeError: Failed to fetch`, which the buy panel
 *     rendered verbatim under the Buy button.
 *
 *     Rate limiting looks like a network outage here for a specific reason.
 *     mempool.space sends `access-control-allow-origin: *` on its normal
 *     responses and on the errors its application generates, but a rejection
 *     produced in front of the application does not inherit that header —
 *     and a response the browser will not expose is reported to JS as a
 *     network failure, with no status to read. There is no way from here to
 *     tell "you are going too fast" from "you are blocked in this country".
 *   - It answers, and refuses. mempool.space caps a UTXO listing at 500 and
 *     returns HTTP 400 past it ("Contact support to raise limits"), so a
 *     wallet with a long tail of small receives cannot buy at all.
 *     blockstream.info serves the same address without complaint.
 *
 * Both are the same fact from here: this host will not tell us, ask another
 * one. So every failure falls through — including an HTTP error, which is the
 * part that matters. The tempting rule is "4xx is a real answer, do not retry
 * it", and it is wrong here: mempool.space returns 400 both for an address it
 * will not serve AND for an address that does not parse. The two are
 * indistinguishable from the status alone, and treating the first as final is
 * exactly what leaves that wallet stuck. Asking the next host costs one extra
 * request on a genuinely bad address, which nobody types twice.
 *
 * The hosts speak the same API — Esplora, which mempool.space implements and
 * extends — so `/address/<addr>` and `/address/<addr>/utxo` are byte-for-byte
 * interchangeable between them. Fee estimates are the one place they differ,
 * which is why a host carries its own path and its own reader for that.
 */

export interface EsploraUtxo {
  txid: string;
  vout: number;
  value: number;
  status: { confirmed: boolean };
}

export interface AddressStats {
  /** Satoshi ever received, and ever spent. The difference is the balance. */
  funded: number;
  spent: number;
}

interface Host {
  /** Named to the user when every host is gone, so the message says what to
   *  go and unblock rather than that something went wrong. */
  name: string;
  base: string;
  /** Where this host publishes fee estimates, and how to read a ~30-minute
   *  target out of the shape it answers with. */
  feePath: string;
  halfHour: (data: unknown) => number | null;
}

const positive = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;

/**
 * In preference order. mempool.space leads because it is the estimator the
 * composer already prices against (see lib/wallet/useCompose.ts), and because
 * its fee figures are fractional rather than rounded up to whole sat/vB.
 */
const HOSTS: Host[] = [
  {
    name: "mempool.space",
    base: "https://mempool.space/api",
    feePath: "/v1/fees/precise",
    halfHour: (d) => positive((d as { halfHourFee?: unknown } | null)?.halfHourFee),
  },
  {
    name: "blockstream.info",
    base: "https://blockstream.info/api",
    // Esplora's own endpoint: confirmation target in blocks -> sat/vB. Three
    // blocks is the half hour mempool.space names outright.
    feePath: "/fee-estimates",
    halfHour: (d) => positive((d as Record<string, unknown> | null)?.["3"]),
  },
];

/**
 * A host that answered is worth remembering, because the cost of learning a
 * host is blocked is a timeout — and paying that on every call would make the
 * page feel broken for exactly the users this file exists to serve.
 *
 * The stamp is written when the pin CHANGES and never refreshed, which is what
 * makes it expire. A user pinned to the fallback drifts back to the primary
 * later and finds out whether the refusal was permanent; refreshing on every
 * success would pin them to the second choice for good.
 *
 * An hour, because the most common reason to be pinned is the least permanent
 * one. Rate limiting clears in minutes; a national block does not clear at
 * all. Expiring quickly costs the blocked user one FALLBACK_TIMEOUT_MS wait
 * an hour to re-learn what they already knew, and it costs the rate-limited
 * user — who is far more common — nothing beyond that same hour on the
 * fallback. Sized for the frequent case, and merely tolerable for the rare
 * one, which is the right way round.
 */
const PIN_KEY = "esplora-host";
const PIN_TTL_MS = 60 * 60 * 1000;
let pinnedHost: number | null = null;
let pinnedAt = 0;

function preferred(): number {
  if (pinnedHost !== null) {
    return Date.now() - pinnedAt < PIN_TTL_MS ? pinnedHost : 0;
  }
  try {
    const raw = localStorage.getItem(PIN_KEY);
    if (raw) {
      const { i, at } = JSON.parse(raw) as { i?: unknown; at?: unknown };
      if (
        typeof i === "number" &&
        typeof at === "number" &&
        i > 0 &&
        i < HOSTS.length &&
        Date.now() - at < PIN_TTL_MS
      ) {
        pinnedHost = i;
        pinnedAt = at;
        return i;
      }
    }
  } catch {
    // No storage (private mode, a locked-down browser), or something else
    // wrote nonsense under this key. Either way: start at the top.
  }
  return 0;
}

function remember(index: number): void {
  if (index === pinnedHost) return;
  pinnedHost = index;
  pinnedAt = Date.now();
  try {
    // Only a fallback is worth persisting. Pinning index 0 would write on the
    // first successful call for every visitor, to record what the default
    // already says.
    if (index === 0) localStorage.removeItem(PIN_KEY);
    else localStorage.setItem(PIN_KEY, JSON.stringify({ i: index, at: pinnedAt }));
  } catch {
    // The in-memory pin still holds for this page, which is most of the win.
  }
}

/**
 * A host being blocked usually does not refuse the connection, it swallows it
 * — so the way we find out is a timeout, and the length of that timeout is how
 * long the user stares at a dead button. Short while there is somewhere else
 * to go; generous on the last one, where a slow answer still beats none.
 */
const FALLBACK_TIMEOUT_MS = 6_000;
const FINAL_TIMEOUT_MS = 15_000;

/**
 * One read, tried against each host in turn, starting from the pinned one.
 *
 * `pathFor` is a function rather than a string because the fee endpoint is the
 * one thing the hosts do not agree on; the host that answered comes back
 * alongside the data so the caller can use that host's own reader.
 */
async function esplora(
  pathFor: (host: Host) => string,
): Promise<{ data: unknown; host: Host }> {
  const first = preferred();
  const sequence = [first, ...[...HOSTS.keys()].filter((i) => i !== first)];

  let answered = false;
  let lastStatus = "";
  for (let n = 0; n < sequence.length; n++) {
    const index = sequence[n]!;
    const host = HOSTS[index]!;
    const isLast = n === sequence.length - 1;
    try {
      const res = await fetch(`${host.base}${pathFor(host)}`, {
        signal: AbortSignal.timeout(isLast ? FINAL_TIMEOUT_MS : FALLBACK_TIMEOUT_MS),
      });
      // Reachable — worth recording even when it then refuses, because that is
      // what decides which of the two messages below the user gets.
      answered = true;
      if (!res.ok) {
        lastStatus = `HTTP ${res.status}`;
        continue;
      }
      const data: unknown = await res.json();
      remember(index);
      return { data, host };
    } catch {
      // DNS, TLS, a filter, a hang we cut off ourselves, or a body that was
      // not JSON. Nothing here tells them apart, and nothing needs to: the
      // next host is the answer to all of them.
    }
  }

  throw new Error(
    answered
      ? `Bitcoin node couldn't answer (${lastStatus}). Try again in a moment.`
      : `Can't reach a Bitcoin node. ${HOSTS.map((h) => h.name).join(" and ")} both ` +
        `refused this browser — usually rate limiting (wait a minute and retry), ` +
        `or an ad blocker, VPN, or ISP filter.`,
  );
}

/** Every UTXO an address holds, confirmed and unconfirmed. */
export async function fetchAddressUtxos(address: string): Promise<EsploraUtxo[]> {
  const { data } = await esplora(() => `/address/${encodeURIComponent(address)}/utxo`);
  return Array.isArray(data) ? (data as EsploraUtxo[]) : [];
}

/** What an address has ever received and ever spent. */
export async function fetchAddressStats(address: string): Promise<AddressStats> {
  const { data } = await esplora(() => `/address/${encodeURIComponent(address)}`);
  const stats = (
    data as { chain_stats?: { funded_txo_sum?: number; spent_txo_sum?: number } } | null
  )?.chain_stats;
  return { funded: stats?.funded_txo_sum ?? 0, spent: stats?.spent_txo_sum ?? 0 };
}

/**
 * A ~30-minute fee estimate in sat/vB, or null if nobody would say.
 *
 * Null rather than a stand-in number: the caller already has a floor to fall
 * back on, and a default dressed up as an estimate is worse than an admission
 * because it gets multiplied into a price.
 */
export async function fetchHalfHourFeeRate(): Promise<number | null> {
  const { data, host } = await esplora((h) => h.feePath);
  return host.halfHour(data);
}
