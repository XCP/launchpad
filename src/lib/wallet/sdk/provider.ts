import type { XcpProvider, XcpWalletEvents, SignPsbtParams, ConnectionProof, ConnectResult } from './types'
import { BTC_ADDRESS_REGEX, HEX_REGEX, TXID_REGEX, DISCONNECTED } from './constants'

/** Per-method timeouts: interactive methods get longer, passive methods are short. */
const Timeout = {
  fast: 10_000,        // getAccounts, disconnect — should resolve near-instantly
  interactive: 120_000, // connect, sign*, broadcast — user-facing or network-critical
} as const

/** Extract a string field from a provider result, or throw. */
function unwrap(result: unknown, key: string, errorMsg: string): string {
  const value =
    result && typeof result === 'object' && key in result
      ? (result as Record<string, unknown>)[key]
      : undefined
  if (typeof value !== 'string') throw new Error(errorMsg)
  return value
}

/** Wrap a provider.request call with a timeout so a hung wallet can't block forever. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Wallet request timed out')), ms)
    promise.then(
      (v) => { clearTimeout(timer); resolve(v) },
      (e) => { clearTimeout(timer); reject(e) },
    )
  })
}

// Transport-death signatures from the extension's MV3 service worker restarting
// mid-request. User rejection and timeouts are deliberately excluded — those are
// terminal and must not be retried.
const TRANSIENT_DISCONNECT = /disconnect|context invalidated|message port closed|receiving end does not exist/i
function isTransientDisconnect(error: unknown): boolean {
  if (error && typeof error === 'object' && (error as { code?: unknown }).code === DISCONNECTED) return true
  return TRANSIENT_DISCONNECT.test(error instanceof Error ? error.message : String(error ?? ''))
}

/** Typed wrapper around a raw XcpProvider. */
export class XcpWallet {
  constructor(private readonly provider: XcpProvider) {}

  private request(args: { method: string; params?: unknown[] }, timeout: number): Promise<unknown> {
    return withTimeout(this.provider.request(args), timeout)
  }

  // Sign requests retry once if the service worker drops mid-flight. The wallet
  // persists each flow by (origin, method, params), so the retry recovers a
  // result the user already approved or rejoins an open prompt — never a second popup.
  private async signRequest(args: { method: string; params?: unknown[] }, timeout: number): Promise<unknown> {
    try {
      return await this.request(args, timeout)
    } catch (error) {
      if (!isTransientDisconnect(error)) throw error
      return this.request(args, timeout)
    }
  }

  async connect(): Promise<ConnectResult> {
    const result = await this.request({ method: 'xcp_requestAccounts' }, Timeout.interactive)

    // Handle new { accounts, proof } response shape
    let accounts: string[]
    let proof: ConnectionProof | null = null

    if (result && typeof result === 'object' && 'accounts' in result) {
      const r = result as ConnectResult
      accounts = r.accounts
      proof = r.proof
    } else if (Array.isArray(result)) {
      // Backward compatibility with older extension versions
      accounts = result
    } else {
      throw new Error('Wallet returned invalid accounts response')
    }

    for (const addr of accounts) {
      if (typeof addr !== 'string' || !BTC_ADDRESS_REGEX.test(addr)) throw new Error('Wallet returned invalid address')
    }
    return { accounts, proof }
  }

  async getAccounts(): Promise<string[]> {
    const result = await this.request({ method: 'xcp_accounts' }, Timeout.fast)
    if (!Array.isArray(result)) throw new Error('Wallet returned invalid accounts response')
    for (const addr of result) {
      if (typeof addr !== 'string' || !BTC_ADDRESS_REGEX.test(addr)) throw new Error('Wallet returned invalid address')
    }
    return result as string[]
  }

  async disconnect(): Promise<void> {
    await this.request({ method: 'xcp_disconnect' }, Timeout.fast)
  }

  async signMessage(message: string): Promise<string> {
    const result = await this.signRequest({
      method: 'xcp_signMessage',
      params: [message],
    }, Timeout.interactive)
    // Handle both {signature: string} and raw string response shapes
    if (typeof result === 'string') return result
    return unwrap(result, 'signature', 'Wallet returned invalid sign message response')
  }

  async signTransaction(hex: string): Promise<string> {
    const result = await this.signRequest({
      method: 'xcp_signTransaction',
      params: [hex],
    }, Timeout.interactive)
    const signed = unwrap(result, 'hex', 'Wallet returned invalid sign response')
    if (!HEX_REGEX.test(signed)) throw new Error('Wallet returned invalid hex')
    return signed
  }

  async signPsbt(
    psbtHex: string,
    signInputs?: Record<string, number[]>,
    sighashTypes?: number[],
  ): Promise<string> {
    const params: SignPsbtParams = { hex: psbtHex }
    if (signInputs) params.signInputs = signInputs
    if (sighashTypes) params.sighashTypes = sighashTypes
    const result = await this.signRequest({
      method: 'xcp_signPsbt',
      params: [params],
    }, Timeout.interactive)
    const signed = unwrap(result, 'hex', 'Wallet returned invalid PSBT response')
    if (!HEX_REGEX.test(signed)) throw new Error('Wallet returned invalid hex')
    return signed
  }

  /** Broadcast uses interactive timeout — a false timeout is worse than waiting,
   *  since the transaction may have been broadcast successfully. */
  async broadcastTransaction(hex: string): Promise<string> {
    const result = await this.request({
      method: 'xcp_broadcastTransaction',
      params: [hex],
    }, Timeout.interactive)
    const txid = unwrap(result, 'txid', 'Wallet returned invalid broadcast response')
    if (!TXID_REGEX.test(txid)) throw new Error('Wallet returned invalid txid')
    return txid
  }

  on<K extends keyof XcpWalletEvents>(event: K, handler: (...args: XcpWalletEvents[K]) => void): void {
    this.provider.on(event, handler as (...args: any[]) => void)
  }

  off<K extends keyof XcpWalletEvents>(event: K, handler: (...args: XcpWalletEvents[K]) => void): void {
    this.provider.removeListener(event, handler as (...args: any[]) => void)
  }
}
