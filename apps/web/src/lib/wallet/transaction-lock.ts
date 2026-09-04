'use client'

type LockCallback<T> = () => Promise<T>

interface LockManagerLike {
  request<T>(name: string, callback: LockCallback<T>): Promise<T>
}

const fallbackTails = new Map<string, Promise<void>>()

function normalizedAddress(address: string): string {
  return /^(?:bc1|tb1|bcrt1)/i.test(address) ? address.toLowerCase() : address
}

export function addressTransactionLockName(address: string): string {
  return `xcpfun:transaction:${normalizedAddress(address)}`
}

async function withInTabFallback<T>(name: string, callback: LockCallback<T>): Promise<T> {
  const previous = fallbackTails.get(name) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.then(() => current)
  fallbackTails.set(name, tail)

  await previous
  try {
    return await callback()
  } finally {
    release()
    if (fallbackTails.get(name) === tail) fallbackTails.delete(name)
  }
}

/**
 * Hold an address-scoped mutex for compose → sign → broadcast → journal.
 * Web Locks are shared by every same-origin tab. The fallback preserves the
 * old single-tab behavior on browsers without that API.
 */
export function withAddressTransactionLock<T>(
  address: string,
  callback: LockCallback<T>,
  lockManager?: LockManagerLike,
): Promise<T> {
  const name = addressTransactionLockName(address)
  const manager =
    lockManager ??
    (typeof navigator !== 'undefined' && 'locks' in navigator
      ? (navigator.locks as LockManagerLike)
      : undefined)
  return manager ? manager.request(name, callback) : withInTabFallback(name, callback)
}
