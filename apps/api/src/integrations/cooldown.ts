/** A refused read is deferred, never replaced with an early retry or a sleep
 * inside the indexer's 110-second lease. This gate is shared by this isolate;
 * it does not claim to coordinate every Worker in the account. */
let notBefore = 0;
const DEFAULT_COOLDOWN_MS = 30_000;
const READ_LIMIT = 2;
let active = 0;
const queued: Array<{ admit: () => void; reject: (error: unknown) => void }> = [];

function drain(): void {
  if (Date.now() < notBefore) {
    for (const waiting of queued.splice(0)) waiting.reject(new CounterpartyReadDeferred(notBefore));
    return;
  }
  while (active < READ_LIMIT && queued.length > 0) queued.shift()!.admit();
}

function release(): void {
  active--;
  drain();
}

/** The existing read timeout includes admission, so a queue cannot add a
 * second timeout window to work running under the indexer's lease. Only
 * permits are shared; responses and fetch promises belong to their caller. */
export function acquireCounterpartyRead(signal: AbortSignal): Promise<() => void> {
  assertCounterpartyReadAllowed();
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const waiting = {
      admit() {
        signal.removeEventListener("abort", abort);
        active++;
        resolve(release);
      },
      reject(error: unknown) {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    };
    const abort = () => {
      const index = queued.indexOf(waiting);
      if (index >= 0) queued.splice(index, 1);
      waiting.reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    queued.push(waiting);
    drain();
  });
}

export class CounterpartyReadDeferred extends Error {
  constructor(readonly retryAt: number) {
    super("Counterparty read deferred during upstream cooldown");
    this.name = "CounterpartyReadDeferred";
  }
}

export function assertCounterpartyReadAllowed(): void {
  if (Date.now() < notBefore) throw new CounterpartyReadDeferred(notBefore);
}

/** RFC 9110 delay-seconds or HTTP-date. Large valid delays fail closed. */
export function retryAfterDeadline(value: string | null, now: number): number | null {
  const text = value?.trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) {
    const until = now + Number(text) * 1_000;
    return Number.isSafeInteger(until) ? until : Infinity;
  }
  if (!/^(?:Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)(?:, | )/.test(text)) return null;
  // Obsolete asctime HTTP dates are GMT even without a zone suffix.
  let dated = /^[A-Za-z]{3} [A-Za-z]{3} [ \d]\d \d{2}:\d{2}:\d{2} \d{4}$/.test(text)
    ? `${text} GMT` : text;
  const shortYear = /^[A-Za-z]+, (\d{2})-([A-Za-z]{3})-(\d{2}) (\d{2}:\d{2}:\d{2} GMT)$/.exec(text);
  if (shortYear) {
    const futureLimit = new Date(now);
    futureLimit.setUTCFullYear(futureLimit.getUTCFullYear() + 50);
    let year = Math.floor(futureLimit.getUTCFullYear() / 100) * 100 + Number(shortYear[3]);
    dated = `${shortYear[1]} ${shortYear[2]} ${year} ${shortYear[4]}`;
    if (Date.parse(dated) > futureLimit.getTime()) {
      year -= 100;
      dated = `${shortYear[1]} ${shortYear[2]} ${year} ${shortYear[4]}`;
    }
  }
  const until = Date.parse(dated);
  return Number.isFinite(until) ? Math.max(now, until) : null;
}

export function recordCounterpartyCooldown(retryAfter: string | null): void {
  const now = Date.now();
  // Concurrent responses can extend a refusal, never shorten it. Record this
  // before awaiting rejected-body cleanup so other reads cannot slip through.
  notBefore = Math.max(notBefore, retryAfterDeadline(retryAfter, now) ?? now + DEFAULT_COOLDOWN_MS);
  drain();
}
