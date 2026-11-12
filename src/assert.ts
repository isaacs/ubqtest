// The assertion functions. See docs/05-api.md, section 5.
import { isDeepStrictEqual } from 'node:util'
import { emit } from './emit.ts'
import type { Failure } from './events.ts'
import { type Diff, diffDeep, diffEqual, show, showDiffs } from './format.ts'
import { type Hint, hint } from './hint.ts'
import { checkSnapshot } from './snapshot.ts'
import { userFrames } from './stack.ts'
import { current, type TestState } from './state.ts'

/** Thrown by a failed assertion. The test state already has the failure. */
export class AssertionFailure extends Error {
  failure: Failure
  constructor(failure: Failure) {
    super(failure.message)
    this.name = 'AssertionFailure'
    this.failure = failure
  }
}

/**
 * A promise that reports when something awaits it. `await` on a
 * subclass of Promise must call `then`, on each runtime.
 */
class MustAwait<T> extends Promise<T> {
  onThen?: () => void
  static override get [Symbol.species](): PromiseConstructor {
    return Promise
  }
  override then<A = T, B = never>(
    onFulfilled?: ((value: T) => A | PromiseLike<A>) | null,
    onRejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    this.onThen?.()
    return super.then(onFulfilled, onRejected)
  }
}

type ErrorMatch =
  | RegExp
  | (abstract new (...args: any[]) => Error)
  | Record<string, unknown>

type Keys<T> = T extends unknown ? keyof T : never
type Val<T, K> =
  T extends unknown ?
    K extends keyof T ?
      T[K]
    : never
  : never
type Prim<T> = T extends string ? T | RegExp : T
type Obj<O> =
  [O] extends [never] ? never
  : [O] extends [readonly unknown[]] ? { [K in keyof O]: Pattern<O[K]> }
  : { [K in Keys<O>]?: Pattern<Val<O, K>> }
/** A partial shape: listed keys must match, and a RegExp tests a string. */
export type Pattern<T> = Prim<Exclude<T, object>> | Obj<Extract<T, object>>

export interface Assert {
  /** Passes if `value` is truthy. Narrows the type of `value`. */
  (value: unknown, message?: string): asserts value
  /** Passes if `Object.is(actual, expected)`. Narrows the type of `actual`. */
  equal<T, const E extends T>(
    actual: T,
    expected: E,
    message?: string,
  ): asserts actual is E
  /** Passes if not `Object.is(actual, expected)`. */
  notEqual<T>(actual: T, expected: NoInfer<T>, message?: string): void
  /** Passes if both have the same structure, values, and prototypes. */
  deepEqual<T>(actual: T, expected: NoInfer<T>, message?: string): void
  /**
   * Passes if `actual` has the shape of `pattern`. Each key in the
   * pattern must match. Extra keys in `actual` are fine. A RegExp
   * tests a string.
   */
  match<T, const P extends Pattern<T>>(
    actual: T,
    pattern: P,
    message?: string,
  ): void
  /**
   * Passes if `fn` throws an error that fits `expected`: a RegExp
   * tests the message, a class tests `instanceof`, an object is a
   * `match` pattern. Returns the error.
   */
  throws(fn: () => unknown, expected: ErrorMatch, message?: string): Error
  /** As `throws`, for a promise. The result must be awaited. */
  rejects(
    promise: Promise<unknown> | (() => Promise<unknown>),
    expected: ErrorMatch,
    message?: string,
  ): Promise<Error>
  /**
   * Passes if the text of `value` is the text in the snapshot file
   * of the test file. `ubq --update <test>` writes the file.
   */
  snapshot(value: unknown, message?: string): void
  /** Fails the test. */
  fail(message: string): never
  toMatchSnapshot: Hint<'Use assert.snapshot(value)'>
  matchSnapshot: Hint<'Use assert.snapshot(value)'>
  ok: Hint<'Use assert(value)'>
  strictEqual: Hint<'Use assert.equal (it is always strict)'>
  deepStrictEqual: Hint<'Use assert.deepEqual (it is always strict)'>
}

/**
 * Counts one assertion for the current test. Returns undefined if the
 * test already ended: the caller must then do nothing more.
 */
const begin = (): TestState | undefined => {
  const state = current.getStore()
  if (!state) throw new Error('assert was called outside a test')
  if (state.ended) {
    if (!state.failure && !state.late) {
      state.late = true
      const stack = userFrames(new Error().stack)
      emit({
        type: 'late-failure',
        id: state.id,
        failure: {
          kind: 'late',
          message:
            'an assertion ran after the test ended. Await all async work in the test.',
          ...(stack[0] && { at: stack[0] }),
        },
      })
    }
    return undefined
  }
  state.asserts++
  return state
}

const fail = (
  state: TestState,
  assertion: string,
  message: string,
  userMessage: string | undefined,
  diff?: { diffs: Diff[]; more: number },
  values?: { actual: unknown; expected: unknown },
): never => {
  const stack = userFrames(new Error().stack)
  const failure: Failure = {
    kind: 'assert',
    assertion,
    message: userMessage ? `${userMessage}: ${message}` : message,
    ...(stack[0] && { at: stack[0], stack }),
    ...(values && {
      actual: show(values.actual),
      expected: show(values.expected),
    }),
    ...(diff && { diff: showDiffs(diff.diffs, diff.more) }),
  }
  // Recorded before the throw, so that a `catch` in the test cannot
  // hide the failure.
  state.failure ??= failure
  throw new AssertionFailure(failure)
}

/** Why `error` does not fit `expected`, or undefined if it fits. */
const misfit = (
  error: unknown,
  expected: ErrorMatch,
): { diffs: Diff[]; more: number } | undefined => {
  const one = (e: string): { diffs: Diff[]; more: number } => ({
    diffs: [{ path: '', actual: show(error), expected: e }],
    more: 0,
  })
  if (expected instanceof RegExp) {
    const text =
      error instanceof Error ? error.message : String(error)
    return expected.test(text) ? undefined : (
        one(`an error with a message that matches ${expected}`)
      )
  }
  if (typeof expected === 'function') {
    return error instanceof expected ? undefined : (
        one(`an instance of ${expected.name}`)
      )
  }
  const d = diffDeep(error, expected, true)
  return d.diffs.length ? d : undefined
}

const checkExpected = (name: string, expected: unknown): void => {
  if (
    expected === undefined ||
    expected === null ||
    typeof expected === 'string'
  )
    throw new TypeError(
      `assert.${name} needs the expected error as its second argument: a RegExp for the message, an error class, or an object pattern`,
    )
}

const assertFn = (value: unknown, message?: string): void => {
  const state = begin()
  if (state && !value)
    fail(state, 'assert', `expected a truthy value, got ${show(value)}`, message)
}

const methods = {
  equal(actual: unknown, expected: unknown, message?: string): void {
    const state = begin()
    if (state && !Object.is(actual, expected))
      fail(
        state,
        'equal',
        'expected values to be equal',
        message,
        { diffs: [diffEqual(actual, expected)], more: 0 },
        { actual, expected },
      )
  },
  notEqual(actual: unknown, expected: unknown, message?: string): void {
    const state = begin()
    if (state && Object.is(actual, expected))
      fail(
        state,
        'notEqual',
        `expected values to differ, both are ${show(actual)}`,
        message,
      )
  },
  deepEqual(actual: unknown, expected: unknown, message?: string): void {
    const state = begin()
    if (state && !isDeepStrictEqual(actual, expected)) {
      let diff = diffDeep(actual, expected)
      if (!diff.diffs.length)
        diff = { diffs: [diffEqual(actual, expected)], more: 0 }
      fail(state, 'deepEqual', 'expected values to be deeply equal', message, diff, {
        actual,
        expected,
      })
    }
  },
  match(actual: unknown, pattern: unknown, message?: string): void {
    const state = begin()
    if (!state) return
    const diff = diffDeep(actual, pattern, true)
    if (diff.diffs.length)
      fail(state, 'match', 'expected value to match the pattern', message, diff, {
        actual,
        expected: pattern,
      })
  },
  throws(fn: () => unknown, expected: ErrorMatch, message?: string): Error {
    checkExpected('throws', expected)
    const state = begin()
    let error: unknown
    try {
      fn()
    } catch (e) {
      error = e
      const bad = state && misfit(e, expected)
      if (bad)
        fail(state, 'throws', 'the function threw a different error', message, bad)
      return error as Error
    }
    if (state)
      fail(state, 'throws', 'expected the function to throw, but it returned', message)
    return error as Error
  },
  rejects(
    promise: Promise<unknown> | (() => Promise<unknown>),
    expected: ErrorMatch,
    message?: string,
  ): Promise<Error> {
    checkExpected('rejects', expected)
    const state = begin()
    const run = async (): Promise<Error> => {
      let error: unknown
      try {
        await (typeof promise === 'function' ? promise() : promise)
      } catch (e) {
        error = e
        const bad = state && misfit(e, expected)
        if (bad)
          fail(state, 'rejects', 'the promise rejected with a different error', message, bad)
        return error as Error
      }
      if (state)
        fail(state, 'rejects', 'expected the promise to reject, but it resolved', message)
      return error as Error
    }
    const result = new MustAwait<Error>((resolve, reject) => {
      run().then(resolve, reject)
    })
    // A result that nothing awaits must not crash the process.
    Promise.prototype.then.call(result, undefined, () => {})
    if (state) {
      state.unawaited.add(result)
      result.onThen = () => state.unawaited.delete(result)
    }
    return result
  },
  snapshot(value: unknown, message?: string): void {
    const state = begin()
    if (!state) return
    const file = state.id.slice(0, state.id.indexOf(' > '))
    const result = checkSnapshot(file, state.id, value)
    if (!result.ok)
      fail(
        state,
        'snapshot',
        result.message!,
        message,
        result.diffs && { diffs: result.diffs, more: result.more ?? 0 },
      )
  },
  fail(message: string): never {
    const state = begin()
    if (state) fail(state, 'fail', message, undefined)
    throw new Error(message)
  },
  toMatchSnapshot: hint('Use assert.snapshot(value)'),
  matchSnapshot: hint('Use assert.snapshot(value)'),
  ok: hint('Use assert(value)'),
  strictEqual: hint('Use assert.equal (it is always strict)'),
  deepStrictEqual: hint('Use assert.deepEqual (it is always strict)'),
}

export const assert: Assert = Object.assign(assertFn, methods) as Assert
