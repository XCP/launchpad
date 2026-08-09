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
}

declare global {
  interface Window {
    xcpwallet?: XcpProvider
  }
}
