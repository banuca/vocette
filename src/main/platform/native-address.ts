/**
 * Turning whatever koffi hands back for a native pointer into a number.
 *
 * koffi 2.16.3 returns a pointer as an opaque external object: it carries no
 * numeric value and coercing it throws. The object itself is the only form
 * safe to pass back into another call, while `koffi.address()` supplies a
 * separate numeric address used to compare handles and to reject null ones.
 *
 * Comparing addresses rather than objects is what lets two different wrapper
 * objects for the same window count as the same window — assuming otherwise
 * is what silently disabled automatic paste on Windows for a whole release.
 */

/** A native handle as it crosses the koffi boundary. */
export interface NativeHandle {
  /** Exactly what koffi returned; the only form safe to pass back in. */
  readonly value: unknown
  /** Numeric address, for identity and for rejecting null handles. */
  readonly address: bigint
}

/** The one koffi function this needs, so callers can inject a fake. */
export interface AddressResolver {
  address(pointer: never): unknown
}

/**
 * The numeric address behind a handle, or null when it is unusable.
 *
 * A bigint or number is already an address and is kept as it is — except that
 * a number which cannot be represented exactly is rejected rather than
 * silently truncated, because a wrong handle is worse than an unknown one.
 * Null, zero, any other shape, and any conversion failure all mean "unknown".
 */
export function addressOf(koffi: AddressResolver, value: unknown): bigint | null {
  if (typeof value === 'bigint') return value === 0n ? null : value
  if (typeof value === 'number') {
    return value === 0 || !Number.isSafeInteger(value) ? null : BigInt(value)
  }
  if (value === null || value === undefined || typeof value !== 'object') return null
  try {
    const address: unknown = koffi.address(value as never)
    if (typeof address === 'bigint') return address === 0n ? null : address
    if (typeof address === 'number') {
      return address === 0 || !Number.isSafeInteger(address) ? null : BigInt(address)
    }
    return null
  } catch {
    return null
  }
}

export function handleOf(koffi: AddressResolver, value: unknown): NativeHandle | null {
  const address = addressOf(koffi, value)
  return address === null ? null : { value, address }
}
