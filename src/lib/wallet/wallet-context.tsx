'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { detectProvider, XcpWallet, friendlyError, type XcpProvider, type ConnectionProof, type ConnectResult } from './sdk'

type XcpWalletStatus = 'not_detected' | 'disconnected' | 'connected'

interface WalletContextValue {
  status: XcpWalletStatus
  address: string | null
  connectionProof: ConnectionProof | null
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
  const connectingRef = useRef(false)
  const disconnectingRef = useRef(false)
  const walletRef = useRef<XcpWallet | null>(null)
  // Mirrors `address` for event handlers, which must compare the current
  // account without reaching into a state updater (updaters stay pure).
  const addressRef = useRef<string | null>(null)

  /** Adopt an address as the connected account. Proof follows the
   *  address: a fresh proof replaces, a switch without one invalidates.
   *  Stable (setters and refs only) so the mount effect can close over it. */
  const adopt = useCallback((addr: string, proof: ConnectionProof | null) => {
    if (proof) setConnectionProof(proof)
    else if (addressRef.current !== addr) setConnectionProof(null)
    addressRef.current = addr
    setAddress(addr)
    setStatus('connected')
    setConnectError(null)
    storageSet(STORAGE_KEY, addr)
  }, [])

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
    }

    const onDisconnect = () => {
      if (cancelled) return
      addressRef.current = null
      setAddress(null)
      setConnectionProof(null)
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
        if (accounts.length > 0) adopt(accounts[0], null)
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
  }, [adopt])

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
        adopt(result.accounts[0], result.proof)
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
    setStatus('disconnected')
    setConnectError(null)
    storageRemove(STORAGE_KEY)
  }

  const signMessage = (message: string): Promise<string> => {
    if (!walletRef.current) throw new Error('Wallet not available')
    return walletRef.current.signMessage(message)
  }

  const signTransaction = (hex: string): Promise<string> => {
    if (!walletRef.current) throw new Error('Wallet not available')
    return walletRef.current.signTransaction(hex)
  }

  const signPsbt = (
    hex: string,
    signInputs?: Record<string, number[]>,
    sighashTypes?: number[],
  ): Promise<string> => {
    if (!walletRef.current) throw new Error('Wallet not available')
    return walletRef.current.signPsbt(hex, signInputs, sighashTypes)
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
