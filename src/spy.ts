// `spy` and `spyOn`. See docs/05-api.md, section 6.
import { cleanup } from './fixtures.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any

/** One call of a spy. `error` is present if the call threw. */
export interface SpyCall<F extends AnyFn> {
  args: Parameters<F>
  result?: ReturnType<F>
  error?: unknown
}

/** A function that records each call. */
export type Spy<F extends AnyFn = AnyFn> = F & { calls: SpyCall<F>[] }

/** A function that records each call in `calls`, and then calls `impl`. */
export const spy = <F extends AnyFn = (...args: unknown[]) => void>(impl?: F): Spy<F> => {
  if (impl !== undefined && typeof impl !== 'function')
    throw new TypeError('spy() needs a function, or no argument')
  const calls: SpyCall<F>[] = []
  const fn = function (this: unknown, ...args: Parameters<F>): ReturnType<F> {
    const call: SpyCall<F> = { args }
    calls.push(call)
    try {
      return (call.result = impl?.apply(this, args))!
    } catch (error) {
      call.error = error
      throw error
    }
  }
  return Object.assign(fn as unknown as F, { calls })
}

/** The keys of `T` whose values are functions. */
type MethodKeys<T> = { [K in keyof T]-?: T[K] extends AnyFn ? K : never }[keyof T]

/**
 * Replaces the method `key` of `object` with a spy. The spy calls
 * `impl`, or the original method. The original comes back when the
 * test ends.
 */
export const spyOn = <T extends object, K extends MethodKeys<T>>(
  object: T,
  key: K,
  impl?: T[K],
): Spy<T[K] & AnyFn> => {
  const original = object[key]
  if (typeof original !== 'function')
    throw new TypeError(`spyOn: ${String(key)} is not a function of the object`)
  const own = Object.getOwnPropertyDescriptor(object, key)
  const replacement = spy((impl ?? original) as T[K] & AnyFn)
  cleanup(() => {
    if (own) Object.defineProperty(object, key, own)
    else delete object[key]
  })
  // The original can be on the prototype, or have no setter.
  Object.defineProperty(object, key, { value: replacement, configurable: true, writable: true, enumerable: own?.enumerable ?? false })
  return replacement
}
