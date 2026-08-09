/**
 * XCP Wallet SDK — framework-agnostic wallet integration.
 *
 * React apps: use `useWallet()` from `../wallet-context` instead.
 * Non-React: use `detectProvider()` + `new XcpWallet(provider)` directly.
 */
export { detectProvider, getProvider } from './detect'
export { XcpWallet } from './provider'
export { friendlyError } from './errors'
export { validateProof, parseProofMessage } from './verify'
export { BTC_ADDRESS_REGEX, USER_REJECTED, UNAUTHORIZED, UNSUPPORTED_METHOD, DISCONNECTED } from './constants'
export type { XcpProvider, XcpWalletEvents, ConnectionProof, ConnectResult } from './types'
