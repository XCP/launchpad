import { USER_REJECTED, UNAUTHORIZED, UNSUPPORTED_METHOD, DISCONNECTED } from './constants'

function hasCode(e: unknown): e is { code: number } {
  return typeof e === 'object' && e !== null && 'code' in e && typeof (e as Record<string, unknown>).code === 'number'
}

/** Parse wallet / compose errors into user-friendly messages. */
export function friendlyError(e: unknown): string {
  // Prefer structured JSON-RPC error codes when available
  if (hasCode(e)) {
    switch (e.code) {
      case USER_REJECTED: return 'Transaction cancelled'
      case UNAUTHORIZED: return 'Wallet not authorized — please connect first'
      case UNSUPPORTED_METHOD: return 'Method not supported by wallet'
      case DISCONNECTED: return 'Wallet disconnected'
    }
  }

  // Fall back to string matching for unstructured errors
  const msg = e instanceof Error ? e.message : String(e)

  if (msg.includes('User cancelled') || msg.includes('User denied') || msg.includes('User rejected'))
    return 'Transaction cancelled'
  if (msg.includes('WALLET_LOCKED') || msg.includes('Wallet is locked'))
    return 'Wallet is locked — please unlock and try again'
  if (msg.includes('insufficient') || msg.includes('Insufficient'))
    return 'Insufficient balance'
  if (msg.includes('timeout') || msg.includes('Timeout'))
    return 'Request timed out — please try again'
  if (msg.includes('Rate limit'))
    return 'Too many requests — please wait a moment'
  if (msg.includes('dust'))
    return 'Amount too small (below dust limit)'

  // Always log unrecognized errors for debugging (including production)
  console.warn('[wallet]', e)
  return 'Something went wrong — please try again'
}
