'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { detectProvider, XcpWallet, friendlyError, validateProof, UNAUTHORIZED, type XcpProvider, type ConnectionProof, type ConnectResult } from './sdk'
import { canVerifyBip322, verifyBip322 } from '@/lib/bip322'

/**
 * How much we actually know about the connected address's key:
 *  - 'verified' — this session saw a fresh proof and its BIP-322 signature checked out.
 *  - 'unverified' — nothing to check. A restored session, an accountsChanged
 *    switch, or an address type we can't verify; xcp_accounts carries no proof,
 *    so this is the normal resting state, not a warning.
 *  - 'failed' — a proof WAS supplied and did not verify. The only genuinely
 *    suspicious state, and the one that gates metadata editing.
 */
export type ProofStatus = 'unverified' | 'verified' | 'failed'

/** Check a proof against the address that supplied it. An address type we
 *  can't verify reports 'unverified', never 'failed' — a coverage gap and a
 *  bad signature are different claims and must not look the same. */
async function checkProof(proof: ConnectionProof, addr: string): Promise<ProofStatus> {
  if (!canVerifyBip322(addr)) return 'unverified'
  const check = await validateProof(proof, window.location.origin, addr, {
    verifySignature: async (message, signature, address) => {
      try { return verifyBip322(address, message, signature) } catch { return false }
    },
  })
  if (!check.valid) console.warn('[wallet] connection proof did not verify:', check.reason)
  return check.valid ? 'verified' : 'failed'
}

type XcpWalletStatus = 'not_detected' | 'disconnected' | 'connected'

interface WalletContextValue {
  status: XcpWalletStatus
  address: string | null
  connectionProof: ConnectionProof | null
  /** Active address public key, when the wallet can supply one. */
  publicKey: string | null
  proofStatus: ProofStatus
  connecting: boolean
  connectError: string | null
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  signMessage: (message: string) => Promise<string>
  signTransaction: (hex: string) => Promise<string>
  signPsbt: (hex: string, signInputs?: Record<string, number[]>, sighashTypes?: number[]) => Promise<string>
  broadcastTransaction: (hex: string) => Promise<string>
}

const WalletContext = createContext<WalletContextValue | null>(null)

/**
 * Stores the connected ADDRESS (legacy value: '1'). The address lets a
 * reload restore the connection optimistically: the extension's MV3
 * service worker is idle-killed and a cold worker answers xcp_accounts
 * with [] even for an approved origin with an unlocked wallet (its
 * keychain only rehydrates when the extension popup opens). An empty
 * answer therefore means "unavailable right now", never "revoked" — the
 * two are indistinguishable from the page, so we stay connected and let
 * events, polling, or a failed signing attempt resolve the ambiguity.
 */
const STORAGE_KEY = 'xcp-wallet-connected'
/** Passive reconcile cadence — 4 req/min against a 100/min origin limit. */
const RECONCILE_MS = 15_000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function storageGet(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function storageSet(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch {}
}
function storageRemove(key: string) {
  try { localStorage.removeItem(key) } catch {}
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<XcpWalletStatus>('not_detected')
  const [address, setAddress] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [connectionProof, setConnectionProof] = useState<ConnectionProof | null>(null)
  const [proofStatus, setProofStatus] = useState<ProofStatus>('unverified')
  const [keyedPublicKey, setKeyedPublicKey] = useState<{
    address: string
    publicKey: string
  } | null>(null)
  const connectingRef = useRef(false)
  const disconnectingRef = useRef(false)
  const walletRef = useRef<XcpWallet | null>(null)
  // Mirrors `address` for event handlers, which must compare the current
  // account without reaching into a state updater (updaters stay pure).
  const addressRef = useRef<string | null>(null)
  /** Addresses already put through reverify, so a 15s reconcile tick doesn't
   *  re-ask the wallet for a proof it has already answered. */
  const verifiedAddressRef = useRef<string | null>(null)

  /** Adopt an address as the connected account. Proof follows the
   *  address: a fresh proof replaces, a switch without one invalidates.
   *  Stable (setters and refs only) so the mount effect can close over it. */
  const adopt = useCallback((addr: string, proof: ConnectionProof | null, status: ProofStatus = 'unverified') => {
    if (proof) {
      setConnectionProof(proof)
      setProofStatus(status)
    } else if (addressRef.current !== addr) {
      setConnectionProof(null)
      setProofStatus('unverified')
    }
    addressRef.current = addr
    setAddress(addr)
    setStatus('connected')
    setConnectError(null)
    storageSet(STORAGE_KEY, addr)
  }, [])

  /**
   * Fetch and check a proof for an address we adopted without one — a reload's
   * optimistic restore, or an accountsChanged switch (neither event carries a
   * proof). Without this the badge would be honest but useless: it could only
   * ever be green in the seconds after an explicit Connect click.
   *
   * xcp_accounts is asked first because it is non-interactive, and a non-empty
   * answer proves the origin is still approved — which is what makes the
   * xcp_requestAccounts that follows silent, since the extension returns the
   * stored grant plus a fresh proof without prompting. An empty answer is
   * ambiguous (cold service worker, locked wallet, or genuinely revoked), so
   * we stay unverified rather than risk springing an approval popup nobody
   * asked for; the reconcile loop retries once the worker is warm.
   */
  const reverify = useCallback(async (addr: string) => {
    const wallet = walletRef.current
    if (!wallet || verifiedAddressRef.current === addr) return
    verifiedAddressRef.current = addr
    try {
      const accounts = await wallet.getAccounts()
      if (!accounts.includes(addr)) {
        verifiedAddressRef.current = null
        return
      }
      const result = await wallet.connect()
      // The active address can move while this is in flight; a proof for an
      // address we've since left says nothing about the one we're on.
      if (addressRef.current !== addr || !result.proof) return
      const status = await checkProof(result.proof, addr)
      if (addressRef.current !== addr) return
      setConnectionProof(result.proof)
      setProofStatus(status)
    } catch {
      // Locked, revoked, rate-limited, or the worker died — leave the address
      // adopted and unverified, and allow a later attempt.
      verifiedAddressRef.current = null
    }
  }, [])

  /**
   * The active address's public key, asked for whenever the address changes.
   *
   * Counterparty needs it to compose anything past an OP_RETURN — it falls
   * back to bare multisig, which embeds the source's key — and core can only
   * find one itself once the address has SPENT. A freshly funded wallet
   * never has, which is why a first-ever launch used to fail outright.
   *
   * Asked passively: no prompt, no signature. Older extension builds predate
   * the method and answer null, so callers keep a fallback.
   */
  useEffect(() => {
    if (!address) return
    let cancelled = false
    void (async () => {
      const addresses = await walletRef.current?.getAddresses()
      if (cancelled) return
      const match = [addresses?.active, addresses?.legacy, addresses?.segwit].find(
        (a) => a?.address === address,
      )
      if (match) setKeyedPublicKey({ address, publicKey: match.publicKey })
    })()
    return () => {
      cancelled = true
    }
  }, [address])

  // Stored WITH its address and compared on read, rather than cleared when
  // the address changes: a key belonging to an account we have since left is
  // worse than no key at all, and deriving it means there is no window in
  // which the pair can disagree.
  const publicKey = keyedPublicKey?.address === address ? keyedPublicKey.publicKey : null

  // Detect wallet, subscribe to events, optimistically restore, reconcile
  useEffect(() => {
    let cancelled = false

    const onAccountsChanged = (accounts: string[]) => {
      if (cancelled) return
      if (accounts.length === 0) {
        // Lock, not revocation: the extension emits [] on lock and re-emits
        // the address on unlock; the connection is retained (PROVIDER.md).
        // Revocation arrives as 'disconnect'. Stay connected — a signing
        // attempt on a locked wallet opens its unlock prompt anyway.
        return
      }
      adopt(accounts[0], null)
      void reverify(accounts[0])
    }

    const onDisconnect = () => {
      if (cancelled) return
      addressRef.current = null
      verifiedAddressRef.current = null
      setAddress(null)
      setConnectionProof(null)
      setProofStatus('unverified')
      setStatus('disconnected')
      storageRemove(STORAGE_KEY)
    }

    // Cross-tab: connecting in one tab has no provider event (the
    // extension emits nothing on connect) — the storage write is the
    // only signal the other tabs get.
    const onStorage = (e: StorageEvent) => {
      if (cancelled || e.key !== STORAGE_KEY) return
      if (e.newValue && e.newValue !== '1') adopt(e.newValue, null)
      else if (e.newValue === null) onDisconnect()
    }
    window.addEventListener('storage', onStorage)

    // Ask the warm(ed) worker who we are; adopt any answer. An empty
    // answer proves nothing (cold worker / locked wallet) and never
    // demotes the optimistic state.
    const reconcile = async () => {
      const wallet = walletRef.current
      if (!wallet || cancelled || disconnectingRef.current) return
      if (!storageGet(STORAGE_KEY)) return
      if (document.visibilityState === 'hidden') return
      try {
        const accounts = await wallet.getAccounts()
        if (cancelled || disconnectingRef.current) return
        if (accounts.length > 0) {
          adopt(accounts[0], null)
          void reverify(accounts[0])
        }
      } catch {
        // transient — next tick retries
      }
    }
    const reconcileTimer = setInterval(reconcile, RECONCILE_MS)

    const initWallet = (provider: XcpProvider) => {
      if (cancelled || walletRef.current) return
      const wallet = new XcpWallet(provider)
      walletRef.current = wallet

      wallet.on('accountsChanged', onAccountsChanged)
      wallet.on('disconnect', onDisconnect)

      // Optimistic restore: show the stored address immediately, then
      // reconcile. Waiting for xcp_accounts here is what caused
      // "refresh and I'm logged out" — a cold worker answers [] even
      // for a connected origin.
      const stored = storageGet(STORAGE_KEY)
      if (stored && stored !== '1') {
        addressRef.current = stored
        setAddress(stored)
        setStatus('connected')
      } else {
        setStatus('disconnected')
      }
      if (stored) void reconcile()
    }

    // If detection fails, keep listening for late injection
    let lateHandler: (() => void) | null = null

    detectProvider()
      .then(initWallet)
      .catch(() => {
        // Wallet not detected on initial check — keep listening for late injection.
        // Extension content scripts can take several seconds on cold browser starts.
        if (cancelled) return
        lateHandler = () => {
          if (window.xcpwallet && !cancelled) {
            window.removeEventListener('xcp-wallet#initialized', lateHandler!)
            lateHandler = null
            initWallet(window.xcpwallet)
          }
        }
        window.addEventListener('xcp-wallet#initialized', lateHandler)
      })

    return () => {
      cancelled = true
      clearInterval(reconcileTimer)
      window.removeEventListener('storage', onStorage)
      if (lateHandler) window.removeEventListener('xcp-wallet#initialized', lateHandler)
      walletRef.current?.off('accountsChanged', onAccountsChanged)
      walletRef.current?.off('disconnect', onDisconnect)
    }
  }, [adopt, reverify])

  const connect = async () => {
    if (connectingRef.current) return

    // Re-check for late-injected provider (extension may have loaded after initial detection).
    // Dispatch initialized event to trigger the useEffect's late listener which properly
    // sets up the wallet with event subscriptions (runs synchronously during dispatch).
    if (!walletRef.current && window.xcpwallet) {
      window.dispatchEvent(new Event('xcp-wallet#initialized'))
    }

    const wallet = walletRef.current
    if (!wallet) {
      setConnectError('No XCP wallet extension detected — please install one')
      return
    }
    connectingRef.current = true
    disconnectingRef.current = false
    setConnecting(true)
    setConnectError(null)
    try {
      // Transport recovery is the SDK's job: connect shares signing's
      // durableRequest retry, and the extension persists the approval so
      // a retry after the user clicked resolves with no second popup.
      // This layer only owns one backstop — if both attempts died but the
      // approval landed anyway, a single passive xcp_accounts check (plus
      // the extension's connect-time accountsChanged emit) picks it up.
      let result: ConnectResult | null = null
      try {
        result = await wallet.connect()
      } catch (e) {
        const code = (e as { code?: number })?.code
        if (code === 4001) throw e // genuine denial — surface it
        await sleep(1500)
        const accounts = await wallet.getAccounts().catch(() => [])
        if (accounts.length === 0) throw e
        result = { accounts, proof: null }
      }

      if (disconnectingRef.current) return
      if (result && result.accounts.length > 0) {
        const addr = result.accounts[0]
        // The proof is the only cryptographic tie between "the extension says
        // this address" and "this address's key signed for us, right now, for
        // this origin". Verifying it here does NOT gate connecting: this code
        // runs in the same page that received the proof, so it can't be the
        // security boundary (the metadata write path re-verifies server-side
        // against live on-chain ownership, and that is the real gate). What it
        // buys is an honest answer about what we actually know — and an
        // address type we can't check is a coverage gap, not a red flag, so it
        // must not be reported the same way as a signature that didn't verify.
        const status = result.proof ? await checkProof(result.proof, addr) : 'unverified'
        verifiedAddressRef.current = addr
        adopt(addr, result.proof, status)
      } else {
        setConnectError('The wallet returned no account — open the extension and try again')
      }
    } catch (e) {
      if (!disconnectingRef.current) setConnectError(friendlyError(e))
    } finally {
      connectingRef.current = false
      setConnecting(false)
    }
  }

  const disconnect = async () => {
    disconnectingRef.current = true
    verifiedAddressRef.current = null
    const wallet = walletRef.current
    if (wallet) {
      try {
        await wallet.disconnect()
      } catch (e) {
        console.warn('[wallet] disconnect failed:', e)
      }
    }
    addressRef.current = null
    setAddress(null)
    setConnectionProof(null)
    setProofStatus('unverified')
    setStatus('disconnected')
    setConnectError(null)
    storageRemove(STORAGE_KEY)
  }

  /**
   * The optimistic restore is what keeps a reload from reading as a logout —
   * a cold MV3 service worker answers xcp_accounts with [] even for a live
   * grant, so an empty answer can never be trusted to mean "revoked". The
   * cost is that a grant which really WAS revoked still looks connected here,
   * and the first thing the user learns is an opaque "not connected" error on
   * whatever they were trying to do.
   *
   * A 4100 from a signing call is the unambiguous answer that passive polling
   * can't give: the wallet itself says this origin isn't authorized. Treat it
   * as the disconnect we couldn't detect earlier, so the UI offers Connect
   * instead of failing the same way again.
   */
  const onUnauthorized = () => {
    addressRef.current = null
    verifiedAddressRef.current = null
    setAddress(null)
    setConnectionProof(null)
    setProofStatus('unverified')
    setStatus('disconnected')
    setConnectError('Wallet is no longer connected to this site — reconnect to continue')
    storageRemove(STORAGE_KEY)
  }

  const withAuthCheck = async <T,>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run()
    } catch (e) {
      if ((e as { code?: number })?.code === UNAUTHORIZED) onUnauthorized()
      throw e
    }
  }

  const signMessage = (message: string): Promise<string> => {
    if (!walletRef.current) throw new Error('Wallet not available')
    return withAuthCheck(() => walletRef.current!.signMessage(message))
  }

  const signTransaction = (hex: string): Promise<string> => {
    if (!walletRef.current) throw new Error('Wallet not available')
    return withAuthCheck(() => walletRef.current!.signTransaction(hex))
  }

  const signPsbt = (
    hex: string,
    signInputs?: Record<string, number[]>,
    sighashTypes?: number[],
  ): Promise<string> => {
    if (!walletRef.current) throw new Error('Wallet not available')
    return withAuthCheck(() => walletRef.current!.signPsbt(hex, signInputs, sighashTypes))
  }

  const broadcastTransaction = (hex: string): Promise<string> => {
    if (!walletRef.current) throw new Error('Wallet not available')
    return walletRef.current.broadcastTransaction(hex)
  }

  return (
    <WalletContext value={{
      status,
      address,
      connectionProof,
      publicKey,
      proofStatus,
      connecting,
      connectError,
      connect,
      disconnect,
      signMessage,
      signTransaction,
      signPsbt,
      broadcastTransaction,
    }}>
      {children}
    </WalletContext>
  )
}

export function useWallet() {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWallet must be used within WalletProvider')
  return ctx
}
