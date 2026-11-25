// `spy` and `spyOn`. See docs/05-api.md, section 6.
import { TEST_CONSOLE } from './capture.ts'
import { changed, cleanup } from './fixtures.ts'
import { counted } from './counted.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
/** A function with any arguments and any result. */
type AnyFn = (...args: any[]) => any

/**
 * One call of a spy: its arguments, and its result. `error` is present,
 * and `result` is not, if the call threw. `this` is the `this` value
 * of the call. It is not enumerable: `assert.deepEqual` of a call
 * with `{ args, result }` does not see it. `args` is `unknown[]`: the
 * code under test can pass more arguments, or different ones, than the
 * type of the function has. An expected value of each type compares
 * with it. To read a property of an argument, test its type first.
 */
export interface SpyCall<F extends AnyFn> {
  args: unknown[]
  result?: ReturnType<F>
  error?: unknown
  readonly this?: unknown
}

/**
 * A function that records each call in `calls`. It has the type of the
 * function that it replaces.
 */
export type Spy<F extends AnyFn = AnyFn> = F & { calls: SpyCall<F>[] }

/** The `spy` function, and `spy.results`. */
export interface SpyFunction {
  /**
   * A function that records each call in `calls`, and then calls
   * `impl`. With no `impl`, it takes any arguments and returns
   * `undefined`.
   *
   * ```ts
   * const send = spy((to: string) => to.length)
   * notify(send)
   * assert.equal(send.calls.length, 1)
   * assert.deepEqual(send.calls[0]?.args, ['ann'])
   * ```
   *
   * For a result that changes, the function reads a variable:
   * `let result = 1; const s = spy(() => result)`.
   */
  <F extends AnyFn = AnyFn>(impl?: F): Spy<F>
  /**
   * A spy with a list of results: call 1 gives the first one, call
   * 2 the second one. A result that is an Error instance is
   * thrown. A call after the last result throws.
   *
   * ```ts
   * const read = spy.results('a', 'b', new Error('no more'))
   * assert.equal(read(), 'a')
   * assert.equal(read(), 'b')
   * assert.throws(() => read(), /no more/)
   * ```
   *
   * For an async function, the results are promises. A promise
   * that is rejected in the list is not an unhandled rejection.
   *
   * ```ts
   * const load = spy.results(Promise.resolve(user), Promise.reject(new Error('gone')))
   * ```
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  results<R>(...results: (R | Error)[]): Spy<(...args: any[]) => R>
}

const make = <F extends AnyFn = AnyFn>(impl?: F): Spy<F> => {
  if (impl !== undefined && typeof impl !== 'function') throw new TypeError('spy() needs a function, or no argument')
  const calls: SpyCall<F>[] = []
  const fn = function (this: unknown, ...args: Parameters<F>): ReturnType<F> {
    const call: SpyCall<F> = Object.defineProperty({ args }, 'this', { value: this })
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

const results = <R>(...list: (R | Error)[]): Spy<() => R> => {
  // The code under test handles the rejection when it gets the
  // promise, which can be after Node reports it as not handled.
  for (const one of list) if (one instanceof Promise) one.catch(() => {})
  let next = 0
  return make(() => {
    if (next === list.length)
      throw new Error(
        counted`call ${next + 1} of a spy that has ${list.length} result|results. Give spy.results() a result for each call.`,
      )
    const one = list[next++]
    if (one instanceof Error) throw one
    return one as R
  })
}

export const spy: SpyFunction = Object.assign(make, { results })

/** The keys of `T` whose values are functions. */
type MethodKeys<T> = { [K in keyof T]-?: T[K] extends AnyFn ? K : never }[keyof T]

/**
 * Replaces the method `key` of `object` with a spy. The spy calls
 * `impl`, or the original method. The original comes back when the
 * test ends. A second `spyOn` on the same key replaces the first.
 *
 * ```ts
 * const log = spyOn(console, 'log', () => {})
 * greet('ann')
 * assert.deepEqual(log.calls[0]?.args, ['hello, ann'])
 * ```
 */
export const spyOn = <T extends object, K extends MethodKeys<T>>(object: T, key: K, impl?: T[K]): Spy<T[K] & AnyFn> => {
  // The console of a test file (D134): the spy is on the global
  // console, which the code under test calls.
  const owner = object === (globalThis as Record<symbol, unknown>)[TEST_CONSOLE] ? (globalThis.console as T) : object
  const original = owner[key]
  if (typeof original !== 'function') throw new TypeError(`spyOn: ${String(key)} is not a function of the object`)
  const own = Object.getOwnPropertyDescriptor(owner, key)
  const replacement = spy((impl ?? original) as T[K] & AnyFn)
  cleanup(() => {
    if (own) Object.defineProperty(owner, key, own)
    else delete owner[key]
    changed(owner, key)
  })
  // The original can be on the prototype, or have no setter.
  Object.defineProperty(owner, key, {
    value: replacement,
    configurable: true,
    writable: true,
    enumerable: own?.enumerable ?? false,
  })
  changed(owner, key)
  return replacement
}
