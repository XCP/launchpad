/** Raw provider shape injected by the XCP wallet extension on `window.xcpwallet` */
export interface XcpProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
  on: (event: string, handler: (...args: any[]) => void) => void
  removeListener: (event: string, handler: (...args: any[]) => void) => void
}

/** Typed event map for XcpWallet.on / .off */
export interface XcpWalletEvents {
  accountsChanged: [accounts: string[]]
  disconnect: []
}

/** Proof of address ownership returned during connect */
export interface ConnectionProof {
  address: string
  message: string
  signature: string
  verification: {
    method: 'BIP-322'
    format: string // e.g. 'p2tr', 'p2wpkh', 'p2pkh'
  }
}

/** Response from xcp_requestAccounts */
export interface ConnectResult {
  accounts: string[]
  proof: ConnectionProof | null
}

export interface SignPsbtParams {
  hex: string
  signInputs?: Record<string, number[]>
  sighashTypes?: number[]
  /**
   * For an inscription commit: the reveal's tapleaf script and the taproot internal key, hex.
   * The XCP Wallet re-derives the commit address and message from these and refuses to sign on
   * any mismatch -- without them a commit is unprovable BTC movement and is blocked outright.
   */
  inscription?: { revealScript: string; tapInternalKey: string }
}

/** One address the wallet controls, with the key that proves it. */
export interface WalletAddress {
  address: string
  /** Compressed public key, hex. */
  publicKey: string
  /** e.g. 'p2pkh', 'p2wpkh', 'p2tr'. */
  type: string
}

/**
 * Response from xcp_getAddresses. `legacy` and `segwit` are present only when
 * the site has paired-address permission; `active` always is.
 */
export interface WalletAddresses {
  active: WalletAddress
  legacy?: WalletAddress
  segwit?: WalletAddress
}

declare global {
  interface Window {
    xcpwallet?: XcpProvider
  }
}
