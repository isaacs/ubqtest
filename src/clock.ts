// `fakeClock`: a clock that the test moves. It replaces the timers
// and the clocks of the process until the test ends. See
// docs/05-api.md, section 8.
import * as nodeModule from 'node:module'
import { createRequire } from 'node:module'
import { cleanup } from './fixtures.ts'
import { setImmediate as realSetImmediate } from './real.ts'

export interface FakeClock {
  /** The time of the clock, in milliseconds since 1970. */
  readonly now: number
  /** The count of timers that wait. */
  readonly timers: number
  /**
   * Moves the clock forward by `ms`. Each timer that is due runs, in
   * the order of its time. Promise callbacks run after each timer.
   */
  tick(ms: number): Promise<void>
  /** Moves the clock from timer to timer until no timer waits. */
  runAll(): Promise<void>
  /** Puts the real timers and clocks back. The end of the test does this too. */
  restore(): void
  [Symbol.dispose](): void
}

export interface FakeClockOptions {
  /** The time at the start. The default is the real time. */
  now?: number | Date
}

interface Timer {
  id: number
  at: number
  fn: (...args: unknown[]) => void
  args: unknown[]
  /** For `setInterval`: the time between calls. */
  every?: number
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

let active: FakeClock | undefined

const abortError = (signal: AbortSignal): Error =>
  Object.assign(new Error('The operation was aborted', { cause: signal.reason }), {
    name: 'AbortError',
    code: 'ABORT_ERR',
  })

/**
 * Replaces the timers and the clocks of the process with a clock
 * that moves only when the test moves it. The real ones come back
 * when the test ends, or at `clock.restore()`.
 *
 * ```ts
 * const clock = fakeClock()
 * const done = spy()
 * setTimeout(done, 1000)
 * await clock.tick(1000)
 * assert.equal(done.calls.length, 1)
 * ```
 */
export const fakeClock = (options: FakeClockOptions = {}): FakeClock => {
  if (active)
    throw new Error('a fake clock is active. Call restore() on it before the next fakeClock() call.')
  const RealDate = Date
  const start = options.now === undefined ? RealDate.now() : +options.now
  if (!Number.isFinite(start)) throw new TypeError('fakeClock: now must be a number or a Date')
  // Before each change, so that a call after the end of its test
  // changes nothing.
  cleanup(() => clock.restore())
  let now = start
  let ids = 0
  const timers = new Map<number, Timer>()

  const add = (fn: unknown, ms: unknown, args: unknown[], every?: number): Any => {
    if (typeof fn !== 'function') throw new TypeError('The "callback" argument must be of type function')
    const delay = Math.max(0, Number(ms) || 0)
    const timer: Timer = { id: ++ids, at: now + delay, fn: fn as Timer['fn'], args }
    if (every !== undefined) timer.every = Math.max(1, every)
    timers.set(timer.id, timer)
    // The form of a Node timer object.
    const handle = {
      ref: () => handle,
      unref: () => handle,
      hasRef: () => true,
      refresh: () => {
        timer.at = now + delay
        return handle
      },
      close: () => {
        timers.delete(timer.id)
        return handle
      },
      [Symbol.toPrimitive]: () => timer.id,
      [Symbol.dispose]: () => void timers.delete(timer.id),
    }
    return handle
  }
  const clear = (handle: unknown): void => {
    if (handle != null) timers.delete(+(handle as number))
  }

  const fakes = {
    setTimeout: (fn: unknown, ms?: unknown, ...args: unknown[]) => add(fn, ms, args),
    setInterval: (fn: unknown, ms?: unknown, ...args: unknown[]) => {
      // No time, or a time that is not a finite number, is 1 ms.
      const every = Number.isFinite(ms) ? (ms as number) : 1
      return add(fn, every, args, every)
    },
    setImmediate: (fn: unknown, ...args: unknown[]) => add(fn, 0, args),
    clearTimeout: clear,
    clearInterval: clear,
    clearImmediate: clear,
  }

  /** A promise that a fake timer resolves, as in `node:timers/promises`. */
  const wait = <T>(ms: unknown, value: T, options?: { signal?: AbortSignal }): Promise<T> =>
    new Promise((resolve, reject) => {
      const signal = options?.signal
      if (signal?.aborted) return reject(abortError(signal))
      const handle = add(() => resolve(value), ms, [])
      signal?.addEventListener(
        'abort',
        () => {
          clear(handle)
          reject(abortError(signal))
        },
        { once: true },
      )
    })
  const promiseFakes = {
    setTimeout: (ms?: number, value?: unknown, options?: { signal?: AbortSignal }) =>
      wait(ms ?? 1, value, options),
    setImmediate: (value?: unknown, options?: { signal?: AbortSignal }) => wait(0, value, options),
    async *setInterval(ms?: number, value?: unknown, options?: { signal?: AbortSignal }) {
      for (;;) yield await wait(ms ?? 1, value, options)
    },
  }

  const FakeDate = function (this: unknown, ...args: unknown[]) {
    if (!new.target) return new RealDate(now).toString()
    return Reflect.construct(RealDate, args.length ? args : [now], new.target)
  } as unknown as DateConstructor
  Object.setPrototypeOf(FakeDate, RealDate)
  ;(FakeDate as Any).prototype = RealDate.prototype
  FakeDate.now = () => now

  const realPerformanceNow = performance.now
  // A whole number, so that a tick of whole milliseconds moves
  // `performance.now()` by exactly that amount.
  const origin = Math.ceil(realPerformanceNow.call(performance))
  const hrtime = ((previous?: [number, number]): [number, number] => {
    const ms = origin + (now - start)
    const at: [number, number] = [Math.floor(ms / 1e3), Math.round((ms % 1e3) * 1e6)]
    if (!previous) return at
    const nanos = at[1] - previous[1]
    return nanos < 0 ? [at[0] - previous[0] - 1, nanos + 1e9] : [at[0] - previous[0], nanos]
  }) as typeof process.hrtime
  hrtime.bigint = () => BigInt(Math.round((origin + (now - start)) * 1e6))

  // Replaces `object[key]` and returns the function that puts the
  // old value back.
  const undo: (() => void)[] = []
  const replace = (object: Any, key: string, value: unknown): void => {
    const old = Object.getOwnPropertyDescriptor(object, key)
    try {
      Object.defineProperty(object, key, { value, configurable: true, writable: true, enumerable: old?.enumerable ?? true })
      // ubq: not measured: the runtimes of the tests permit each change
    } catch {
      // The runtime does not permit a change of this one.
      return
    }
    undo.push(() => {
      if (old) Object.defineProperty(object, key, old)
      else delete object[key]
    })
  }

  for (const [key, fn] of Object.entries(fakes)) replace(globalThis, key, fn)
  replace(globalThis, 'Date', FakeDate)
  replace(performance, 'now', () => origin + (now - start))
  replace(process, 'hrtime', hrtime)
  replace(AbortSignal, 'timeout', (ms: number) => {
    const controller = new AbortController()
    add(() => controller.abort(new DOMException('The operation was aborted due to timeout', 'TimeoutError')), ms, [])
    return controller.signal
  })
  // `import { setTimeout } from 'node:timers'` has its own names.
  const require = createRequire(import.meta.url)
  const timersModule = require('node:timers')
  for (const [key, fn] of Object.entries(fakes)) replace(timersModule, key, fn)
  const promises = require('node:timers/promises')
  for (const [key, fn] of Object.entries(promiseFakes)) replace(promises, key, fn)
  if (promises.scheduler) {
    replace(promises.scheduler, 'wait', (ms: number, options?: { signal?: AbortSignal }) => wait(ms, undefined, options))
    replace(promises.scheduler, 'yield', () => wait(0, undefined))
  }
  replace(timersModule, 'promises', promises)
  nodeModule.syncBuiltinESMExports?.()

  /** Lets promise callbacks run. This uses the real event loop. */
  const settle = (): Promise<void> => new Promise(resolve => realSetImmediate(resolve))

  /** The timer that is due first at or before `limit`. */
  const next = (limit: number): Timer | undefined => {
    let first: Timer | undefined
    for (const timer of timers.values())
      if (timer.at <= limit && (!first || timer.at < first.at)) first = timer
    return first
  }
  const run = async (timer: Timer): Promise<void> => {
    now = Math.max(now, timer.at)
    if (timer.every === undefined) timers.delete(timer.id)
    else timer.at += timer.every
    timer.fn(...timer.args)
    await settle()
  }

  let restored = false
  const clock: FakeClock = {
    get now() {
      return now
    },
    get timers() {
      return timers.size
    },
    async tick(ms) {
      if (restored) throw new Error('the fake clock was restored. Make a new one with fakeClock().')
      if (typeof ms !== 'number' || !(ms >= 0)) throw new TypeError('tick() needs a number of milliseconds, 0 or more')
      const target = now + ms
      await settle()
      for (let timer = next(target); timer; timer = next(target)) await run(timer)
      now = target
    },
    async runAll() {
      if (restored) throw new Error('the fake clock was restored. Make a new one with fakeClock().')
      await settle()
      let count = 0
      for (let timer = next(Infinity); timer; timer = next(Infinity)) {
        if (++count > 10_000)
          throw new Error(
            'runAll() ran 10000 timers and more timers wait. A timer that starts itself again, or setInterval, never ends. Use tick(ms).',
          )
        await run(timer)
      }
    },
    restore() {
      if (restored) return
      restored = true
      active = undefined
      for (let fn = undo.pop(); fn; fn = undo.pop()) fn()
      nodeModule.syncBuiltinESMExports?.()
      timers.clear()
    },
    [Symbol.dispose]() {
      clock.restore()
    },
  }
  active = clock
  return clock
}
