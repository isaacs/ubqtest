// The assertion functions. See docs/05-api.md, section 5.
import { isDeepStrictEqual } from 'node:util'
import { emit } from './emit.ts'
import type { Failure } from './events.ts'
import { type Diff, diffDeep, diffEqual, show, showDiffs } from './format.ts'
import { type Hint, hint } from './hint.ts'
import { now, setTimeout } from './real.ts'
import { checkSnapshot } from './snapshot.ts'
import { userFrames } from './stack.ts'
import { current, type TestState } from './state.ts'
import { counted } from './counted.ts'

/** The count of `isDeepEqual`, `isMatch`, and `isMatchOnly` calls that a failure of `assert` shows. */
const MAX_COMPARED = 8

/** Thrown by a failed assertion. The test state already has the failure. */
export class AssertionFailure extends Error {
  failure: Failure
  /** True for an assertion that failed outside a test: no test has the failure. */
  outside: boolean
  constructor(failure: Failure, outside = false) {
    super(failure.message)
    this.name = 'AssertionFailure'
    this.failure = failure
    this.outside = outside
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

/**
 * What `assert.throws` and `assert.rejects` compare an error with: a
 * RegExp for the message, a class, or a `match` pattern.
 */
type ErrorMatch = RegExp | (abstract new (...args: any[]) => unknown) | Record<string, unknown>

/** A function in a pattern: it tests the value at its place. */
type Predicate = (value: unknown) => boolean
/** True if `A` and `B` are the same type. */
type Same<A, B> = (<V>() => V extends A ? 1 : 2) extends <V>() => V extends B ? 1 : 2 ? true : false
/**
 * The pattern `P`, with a function that is not a predicate made a
 * compile error. This check does not use the type of the value, so
 * it works for a value of type `unknown` too. It goes into arrays,
 * and into objects where each key is readonly: an object literal in
 * the call is such an object, and a `Date` or a `Map` is not.
 */
type Checked<P> = P extends (...args: never[]) => unknown
  ? P extends Predicate
    ? P
    : Hint<'A function in a pattern must be (value: unknown) => boolean. To compare a function as a value, use assert.equal'>
  : P extends readonly unknown[]
    ? { [K in keyof P]: Checked<P[K]> }
    : P extends object
      ? Same<P, Readonly<P>> extends true
        ? { [K in keyof P]: Checked<P[K]> }
        : P
      : P
/** At the top level, a RegExp or a class is not a pattern. */
type CheckedError<P> = P extends RegExp | (abstract new (...args: any[]) => unknown) ? unknown : Checked<P>

/** The keys of each member of a union. */
type Keys<T> = T extends unknown ? keyof T : never
/** The type of the key `K` in the members of a union that have it. */
type Val<T, K> = T extends unknown ? (K extends keyof T ? T[K] : never) : never
/**
 * The pattern of a value that is not an object: the value, or a RegExp for
 * a string.
 */
type Prim<T> = T extends string ? T | RegExp : T
/**
 * The pattern of the objects of a type. An array has a pattern for
 * each element. For the other objects, each key is optional, and a
 * key of each member of a union is a key of the pattern.
 */
type Obj<O> = Arr<Extract<O, readonly unknown[]>> | Keyed<Exclude<O, readonly unknown[]>>
/**
 * The pattern of each array type of a union. A tuple has a pattern
 * for each place. An array of any length has one pattern type for
 * its elements, as an array type: the type can then have itself in
 * it, as a JSON type does.
 */
type Arr<A> = A extends readonly unknown[]
  ? number extends A['length']
    ? PatternList<A[number]>
    : { [K in keyof A]: Pattern<A[K]> }
  : never
/** An interface: the checker reads it only when it needs it. */
interface PatternList<E> extends ReadonlyArray<Pattern<E>> {}
type Keyed<O> = [O] extends [never] ? never : { [K in Keys<O>]?: Pattern<Val<O, K>> }
/**
 * A partial shape: listed keys must match, a RegExp tests a string,
 * and a function is a predicate for the value at its place.
 */
export type Pattern<T> = Prim<Exclude<T, object>> | Obj<Extract<T, object>> | Predicate

/** The type of `assert`. */
export interface Assert {
  /**
   * Passes if `value` is truthy. Narrows the type of `value`.
   *
   * ```ts
   * const user = find('ann')
   * assert(user)
   * assert(user.kind === 'admin')
   * assert(error instanceof RangeError, 'the kind of error')
   * ```
   */
  (value: unknown, message?: string): asserts value
  /**
   * Passes if `Object.is(actual, expected)`. It does not narrow the
   * type of `actual`: a test often reads a value again after the
   * code under test changed it. To narrow, use `assert(a === b)`.
   * `expected` must have the type of `actual`. To compare two
   * different types on purpose: `assert.equal<unknown>(a, b)`.
   *
   * ```ts
   * assert.equal(add(1, 2), 3)
   * ```
   */
  equal<T>(actual: T, expected: NoInfer<T>, message?: string): void
  /**
   * Passes if not `Object.is(actual, expected)`.
   *
   * ```ts
   * assert.notEqual(nextId(), firstId)
   * ```
   */
  notEqual<T>(actual: T, expected: NoInfer<T>, message?: string): void
  /**
   * Passes if both have the same structure, values, and prototypes.
   * It is strict: `1` is not `'1'`, and a class instance is not a
   * plain object. A failure shows each difference with its path.
   *
   * ```ts
   * assert.deepEqual(parse('a=1'), { a: '1' })
   * ```
   */
  deepEqual<T>(actual: T, expected: NoInfer<T>, message?: string): void
  /**
   * Passes if `value > target`. A failure shows the two values.
   * The type of `value` can have `null` and `undefined` in it, for
   * a value such as `row?.count`: they fail.
   *
   * ```ts
   * assert.greaterThan(items.length, 0)
   * ```
   */
  greaterThan(value: number | bigint | null | undefined, target: number | bigint, message?: string): void
  /**
   * Passes if `value < target`. A failure shows the two values.
   *
   * ```ts
   * assert.lessThan(elapsed, 100)
   * ```
   */
  lessThan(value: number | bigint | null | undefined, target: number | bigint, message?: string): void
  /** Passes if `value >= target`. A failure shows the two values. */
  greaterThanOrEqual(value: number | bigint | null | undefined, target: number | bigint, message?: string): void
  /** Passes if `value <= target`. A failure shows the two values. */
  lessThanOrEqual(value: number | bigint | null | undefined, target: number | bigint, message?: string): void
  /**
   * Passes if `value` is near `target`: the difference is less than
   * `10 ** -precision / 2`. The default `precision` is 2, a difference
   * of less than 0.005. Two values that are equal pass.
   *
   * ```ts
   * assert.close(0.1 + 0.2, 0.3)
   * assert.close(ratio, 1.15, 6)
   * ```
   */
  close(value: number | null | undefined, target: number, precision?: number, message?: string): void
  /**
   * Passes if `actual` has the shape of `pattern`. Each key in the
   * pattern must match. Extra keys in `actual` are fine. A RegExp
   * tests a string. A function in the pattern gets the value at
   * its place, and the value matches if the function returns
   * true: `{ id: (v: unknown) => typeof v === 'number' }`. A key
   * that `actual` does not have gives `undefined`. To compare a
   * function as a value, use `assert.equal`. An array in the
   * pattern must have the same length as the array in `actual`.
   *
   * ```ts
   * assert.match(user, { name: /^A/, roles: ['admin'] })
   * assert.match(line, /^pass: /)
   * ```
   */
  match<T, const P extends Pattern<T> = Pattern<T>>(actual: T, pattern: P & Checked<P>, message?: string): void
  /**
   * As `match`, and `actual` must have no key that the pattern
   * does not have, at each depth. Use it for an exact comparison
   * with a value that changes: a function in the pattern tests
   * that value.
   *
   * ```ts
   * assert.matchOnly(event, { id: 1, time: (v: unknown) => typeof v === 'number' })
   * ```
   */
  matchOnly<T, const P extends Pattern<T> = Pattern<T>>(actual: T, pattern: P & Checked<P>, message?: string): void
  /**
   * Passes if the text `actual` has the text `expected` in it, or if
   * an element of the iterable `actual` is `expected`. Fails on null
   * and undefined. For long text, a failure shows the part near
   * the longest start of `expected` that the text has.
   *
   * ```ts
   * assert.contains(page, 'Welcome')
   * assert.contains(new Set(roles), 'admin')
   * ```
   */
  contains(actual: string | null | undefined, expected: string, message?: string): void
  contains<T>(actual: Iterable<T> | null | undefined, expected: T, message?: string): void
  /** The opposite of `contains`. Fails on null and undefined. */
  notContains(actual: string | null | undefined, expected: string, message?: string): void
  notContains<T>(actual: Iterable<T> | null | undefined, expected: T, message?: string): void
  /**
   * Passes if `fn` throws an error that fits `expected`: a RegExp
   * tests the message, a class tests `instanceof`, an object is a
   * `match` pattern. `expected` is required. Returns the error.
   *
   * ```ts
   * assert.throws(() => parse('?'), /unknown shape/)
   * const error = assert.throws(() => parse('?'), RangeError)
   * assert.throws(() => open(path), { code: 'ENOENT' })
   * ```
   */
  throws<const P extends ErrorMatch>(fn: () => unknown, expected: P & CheckedError<P>, message?: string): Error
  /**
   * As `throws`, for a promise, or for a function that returns one.
   * The result must be awaited: a test that does not await it
   * fails. It resolves to the value that the promise rejected with.
   *
   * ```ts
   * await assert.rejects(load('gone'), /not found/)
   * ```
   */
  rejects<const P extends ErrorMatch>(
    promise: PromiseLike<unknown> | (() => PromiseLike<unknown>),
    expected: P & CheckedError<P>,
    message?: string,
  ): Promise<Error>
  /**
   * As `match`, for a value that changes with time, such as the text
   * of a page. Calls `fn` again and again until its value matches
   * `pattern`. Fails after 2000 ms with the last value. The result
   * must be awaited.
   *
   * ```ts
   * await assert.eventually(() => page.title(), 'Done')
   * ```
   */
  eventually<T, const P extends Pattern<Awaited<T>> = Pattern<Awaited<T>>>(
    fn: () => T,
    pattern: P & Checked<P>,
    message?: string,
  ): Promise<void>
  /**
   * Passes if the text of `value` is the text in the snapshot file
   * of the test file. `ubq --update <test>` writes the file. The
   * files are in `ubq-snapshots/`: commit them.
   */
  snapshot(value: unknown, message?: string): void
  /**
   * Fails the test.
   *
   * ```ts
   * if (kind === 'never') assert.fail('this case cannot occur')
   * ```
   */
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
 *
 * Outside a test, an assertion is a function that throws if its
 * check fails (D117): at the top level of a file, or in a cleanup
 * function of the file. It then gets a state that no test has.
 */
const begin = (): TestState | undefined => {
  const state = current.getStore()
  if (!state)
    return {
      id: '',
      asserts: 0,
      ended: false,
      late: false,
      unawaited: new Set(),
      cleanups: [],
      kept: [],
      // ubq: not measured: only a test with a promise that waits has a use for it
      fail() {},
    }
  if (state.ended) {
    if (!state.failure && !state.late) {
      state.late = true
      const stack = userFrames(new Error().stack)
      emit({
        type: 'late-failure',
        id: state.id,
        failure: {
          kind: 'late',
          message: 'an assertion ran after the test ended. Await all async work in the test.',
          ...(stack[0] && { at: stack[0] }),
        },
      })
    }
    return undefined
  }
  state.asserts++
  state.compared = undefined
  return state
}

const fail = (
  state: TestState,
  assertion: string,
  message: string,
  userMessage: string | undefined,
  diff?: { diffs: Diff[]; more: number },
  values?: { actual: unknown; expected: unknown },
  /** Made at the call of the assertion, if the check runs after an `await`. */
  called = new Error(),
): never => {
  const stack = userFrames(called.stack)
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
  throw new AssertionFailure(failure, !state.id)
}

/** Why `error` does not fit `expected`, or undefined if it fits. */
const misfit = (error: unknown, expected: ErrorMatch): { diffs: Diff[]; more: number } | undefined => {
  const one = (e: string): { diffs: Diff[]; more: number } => ({
    diffs: [{ path: '', actual: show(error), expected: e }],
    more: 0,
  })
  if (expected instanceof RegExp) {
    const text = error instanceof Error ? error.message : String(error)
    return expected.test(text) ? undefined : one(`an error with a message that matches ${expected}`)
  }
  if (typeof expected === 'function') {
    if (error instanceof expected) return undefined
    const d = one(`an instance of ${expected.name}`)
    // jest and vitest pass `toThrow()` for each thrown value.
    if (expected === Error)
      d.diffs[0]!.note =
        'the value is not an Error instance. For such a value, use a RegExp: it tests String(value). The assertion returns the value.'
    return d
  }
  const d = diffDeep(error, expected, true)
  return d.diffs.length ? d : undefined
}

const checkExpected = (name: string, expected: unknown): void => {
  if (expected === undefined || expected === null || typeof expected === 'string')
    throw new TypeError(
      `assert.${name} needs the expected error as its second argument: a RegExp for the message, an error class, or an object pattern`,
    )
}

/** The time limit of `assert.eventually`, and the wait between two calls. */
const EVENTUALLY_MS = 2000
const POLL_MS = 20

/**
 * The promise of an assertion that must be awaited. The test fails
 * if nothing awaits it.
 */
const mustAwait = <T>(state: TestState | undefined, run: () => Promise<T>): Promise<T> => {
  const result = new MustAwait<T>((resolve, reject) => {
    run().then(resolve, reject)
  })
  // A result that nothing awaits must not crash the process.
  Promise.prototype.then.call(result, undefined, () => {})
  if (state) {
    state.unawaited.add(result)
    result.onThen = () => state.unawaited.delete(result)
  }
  return result
}

/**
 * The index of `expected` in the text or the iterable `actual`, or
 * -1. Undefined if `actual` is not text and not an iterable.
 */
const find = (actual: unknown, expected: unknown): number | undefined => {
  if (typeof actual === 'string') return actual.indexOf(String(expected))
  if (actual == null || typeof (actual as Iterable<unknown>)[Symbol.iterator] !== 'function') return undefined
  // The same test as Array.prototype.includes: NaN finds NaN.
  return [...(actual as Iterable<unknown>)].findIndex(v => v === expected || (v !== v && expected !== expected))
}

const WINDOW = 400

/** Long text shows only the part near `at`, so that a failure shows the place. */
const excerpt = (text: string, at: number, note: string[]): string => {
  if (text.length <= WINDOW) return show(text)
  const from = Math.max(0, Math.min(at - WINDOW / 4, text.length - WINDOW))
  note.push(`this is characters ${from} to ${from + WINDOW} of ${text.length}`)
  return show(text.slice(from, from + WINDOW))
}

/** The failure of contains or notContains. */
const containsFailure = (
  state: TestState,
  assertion: string,
  actual: unknown,
  expected: unknown,
  at: number | undefined,
  message: string | undefined,
): never => {
  if (at === undefined) return fail(state, assertion, `expected text or an iterable, got ${show(actual)}`, message)
  const not = assertion === 'notContains'
  const note: string[] = []
  let shown = show(actual)
  if (typeof actual === 'string') {
    if (!not) {
      // The longest start of the expected text that the text has.
      const wanted = String(expected)
      let length = 0
      for (let hi = wanted.length; length < hi;) {
        const mid = (length + hi + 1) >> 1
        if (actual.includes(wanted.slice(0, mid))) length = mid
        else hi = mid - 1
      }
      at = actual.indexOf(wanted.slice(0, length))
      if (length) note.push(counted`the first ${length} character|characters of the expected text are at index ${at}`)
    }
    shown = excerpt(actual, at, note)
  }
  const text = typeof actual === 'string'
  return fail(
    state,
    assertion,
    text
      ? `expected the text ${not ? 'not ' : ''}to contain the expected text${not ? `, it is at index ${at}` : ''}`
      : `expected ${not ? 'no' : 'an'} element that is the expected value${not ? `, it is at index ${at}` : ''}`,
    message,
    {
      diffs: [
        {
          path: '',
          actual: shown,
          expected: show(expected),
          ...(note.length && { note: note.join('; ') }),
        },
      ],
      more: 0,
    },
  )
}

/** The sign and the words of each comparison of two numbers. */
const COMPARE = {
  greaterThan: ['>', 'greater than the target'],
  lessThan: ['<', 'less than the target'],
  greaterThanOrEqual: ['>=', 'greater than the target, or equal to it'],
  lessThanOrEqual: ['<=', 'less than the target, or equal to it'],
} as const

/** A comparison of two numbers. */
const compare = (
  assertion: keyof typeof COMPARE,
  pass: boolean,
  value: number | bigint | null | undefined,
  target: number | bigint,
  message: string | undefined,
): void => {
  const state = begin()
  const [sign, words] = COMPARE[assertion]
  if (state && !pass)
    fail(state, assertion, `expected a value ${words}`, message, {
      diffs: [{ path: '', actual: show(value), expected: `${sign} ${show(target)}` }],
      more: 0,
    })
}

/** How each function that gives true or false compares. */
const MODE = { isDeepEqual: false, isMatch: true, isMatchOnly: 'only' } as const

/** The longest value that the note of a compared call shows. */
const MAX_NOTE_VALUE = 60

/**
 * The place of the first difference of two large values, as one
 * line. Undefined if the difference is the whole value.
 */
const firstDifference = (actual: unknown, expected: unknown, partial: boolean | 'only'): string | undefined => {
  const first = diffDeep(actual, expected, partial).diffs[0]
  if (!first?.path) return undefined
  const short = (text: string): boolean => text.length <= MAX_NOTE_VALUE && !text.includes('\n')
  const values = short(first.actual) && short(first.expected)
  return `the first difference is at ${first.path}${values ? `: actual ${first.actual}, expected ${first.expected}` : ''}`
}

const assertFn = (value: unknown, message?: string): void => {
  const compared = current.getStore()?.compared
  const state = begin()
  if (!state || value) return
  // `assert(list.some(item => isDeepEqual(item, expected)))` gives
  // only false. The values of those calls show why.
  const diff = compared && {
    diffs: compared.calls.map((call, i) => {
      const where = call.result ? undefined : firstDifference(call.actual, call.expected, MODE[call.name])
      return {
        path: `${call.name} call ${i + 1} gave ${call.result}`,
        actual: show(call.actual),
        expected: show(call.expected),
        ...(where && { note: where }),
      }
    }),
    more: compared.more,
  }
  fail(state, 'assert', `expected a truthy value, got ${show(value)}`, message, diff)
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
      fail(state, 'notEqual', `expected values to differ, both are ${show(actual)}`, message)
  },
  deepEqual(actual: unknown, expected: unknown, message?: string): void {
    const state = begin()
    if (state && !isDeepStrictEqual(actual, expected)) {
      let diff = diffDeep(actual, expected)
      if (!diff.diffs.length) diff = { diffs: [diffEqual(actual, expected)], more: 0 }
      fail(state, 'deepEqual', 'expected values to be deeply equal', message, diff, {
        actual,
        expected,
      })
    }
  },
  greaterThan(value: number | bigint | null | undefined, target: number | bigint, message?: string): void {
    compare('greaterThan', value != null && value > target, value, target, message)
  },
  lessThan(value: number | bigint | null | undefined, target: number | bigint, message?: string): void {
    compare('lessThan', value != null && value < target, value, target, message)
  },
  greaterThanOrEqual(value: number | bigint | null | undefined, target: number | bigint, message?: string): void {
    compare('greaterThanOrEqual', value != null && value >= target, value, target, message)
  },
  lessThanOrEqual(value: number | bigint | null | undefined, target: number | bigint, message?: string): void {
    compare('lessThanOrEqual', value != null && value <= target, value, target, message)
  },
  close(value: number | null | undefined, target: number, precision = 2, message?: string): void {
    const state = begin()
    const limit = 10 ** -precision / 2
    // null is 0 in arithmetic: it must not be near 0.
    if (state && value !== target && !(value != null && Math.abs(value - target) < limit))
      fail(state, 'close', 'expected a value near the target', message, {
        diffs: [{ path: '', actual: show(value), expected: `${show(target)} ± ${limit}` }],
        more: 0,
      })
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
  matchOnly(actual: unknown, pattern: unknown, message?: string): void {
    const state = begin()
    const diff = state && diffDeep(actual, pattern, 'only')
    if (diff?.diffs.length)
      fail(state!, 'matchOnly', 'expected value to match the pattern, with no other keys', message, diff, {
        actual,
        expected: pattern,
      })
  },
  contains(actual: unknown, expected: unknown, message?: string): void {
    const state = begin()
    const at = find(actual, expected)
    if (state && !(at! >= 0)) containsFailure(state, 'contains', actual, expected, at, message)
  },
  notContains(actual: unknown, expected: unknown, message?: string): void {
    const state = begin()
    const at = find(actual, expected)
    if (state && at !== -1) containsFailure(state, 'notContains', actual, expected, at, message)
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
      if (bad) fail(state, 'throws', 'the function threw a different error', message, bad)
      return error as Error
    }
    if (state) fail(state, 'throws', 'expected the function to throw, but it returned', message)
    return error as Error
  },
  rejects(
    promise: PromiseLike<unknown> | (() => PromiseLike<unknown>),
    expected: ErrorMatch,
    message?: string,
  ): Promise<Error> {
    checkExpected('rejects', expected)
    const state = begin()
    // The place of the call. At the time of the failure, the stack
    // has no frame of the test.
    const called = new Error()
    const run = async (): Promise<Error> => {
      let error: unknown
      try {
        await (typeof promise === 'function' ? promise() : promise)
      } catch (e) {
        error = e
        const bad = state && misfit(e, expected)
        if (bad) fail(state, 'rejects', 'the promise rejected with a different error', message, bad, undefined, called)
        return error as Error
      }
      if (state)
        fail(state, 'rejects', 'expected the promise to reject, but it resolved', message, undefined, undefined, called)
      return error as Error
    }
    return mustAwait(state, run)
  },
  eventually(fn: () => unknown, pattern: unknown, message?: string): Promise<void> {
    const state = begin()
    const called = new Error()
    return mustAwait(state, async () => {
      if (!state) return
      const end = now() + EVENTUALLY_MS
      for (;;) {
        const actual = await fn()
        const diff = diffDeep(actual, pattern, true)
        if (!diff.diffs.length) return
        if (now() >= end)
          fail(
            state,
            'eventually',
            `the value did not match the pattern in ${EVENTUALLY_MS} ms`,
            message,
            diff,
            {
              actual,
              expected: pattern,
            },
            called,
          )
        await new Promise(resolve => setTimeout(resolve, POLL_MS))
      }
    })
  },
  snapshot(value: unknown, message?: string): void {
    const state = begin()
    if (!state) return
    if (!state.id) throw new Error('assert.snapshot was called outside a test. A snapshot has the name of its test.')
    const file = state.id.slice(0, state.id.indexOf(' > '))
    const result = checkSnapshot(file, state.id, value)
    if (!result.ok)
      fail(
        state,
        'snapshot',
        result.message!,
        message,
        // checkSnapshot always sets `more` with `diffs`.
        result.diffs && { diffs: result.diffs, more: result.more! },
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

/**
 * The assertions. `assert(value)` passes if `value` is truthy, and
 * each method is one check. A failed assertion throws, and the test
 * stops there. The report has the place, the source line, and the
 * values. Each assertion takes a `message` as its last argument: it
 * goes before the text of the failure.
 *
 * A test must run one assertion or more.
 */
export const assert: Assert = Object.assign(assertFn, methods) as Assert

/**
 * True if the two values are deeply equal, by the rules of
 * `assert.deepEqual`: the same structure, values, and prototypes.
 * It is not an assertion. Use it for a condition that
 * `assert.deepEqual` cannot state, such as "the list has an element
 * that equals this": `assert(list.some(item => isDeepEqual(item,
 * expected)))`. If that assertion fails, the report shows the values
 * of each call.
 */
export const isDeepEqual = (a: unknown, b: unknown): boolean => record('isDeepEqual', a, b, isDeepStrictEqual(a, b))

/**
 * True if `actual` has the shape of `pattern`, by the rules of
 * `assert.match`. It is not an assertion. Use it for a condition
 * that `assert.match` cannot state, such as "a call of the spy has
 * arguments of this shape": `assert(s.calls.some(call =>
 * isMatch(call.args, [{ id: 7 }])))`. If that assertion fails, the
 * report shows the values of each call.
 */
export const isMatch = <T, const P extends Pattern<T> = Pattern<T>>(actual: T, pattern: P & Checked<P>): boolean =>
  record('isMatch', actual, pattern, !diffDeep(actual, pattern, true).diffs.length)

/**
 * True if `actual` has the shape of `pattern` and no other keys, by
 * the rules of `assert.matchOnly`. It is not an assertion. Use it as
 * `isMatch`: `assert(s.calls.some(call => isMatchOnly(call.args,
 * [{ id: 7 }])))`.
 */
export const isMatchOnly = <T, const P extends Pattern<T> = Pattern<T>>(actual: T, pattern: P & Checked<P>): boolean =>
  record('isMatchOnly', actual, pattern, !diffDeep(actual, pattern, 'only').diffs.length)

/** Keeps a call for the report of a failed `assert`. Returns `result`. */
const record = (name: keyof typeof MODE, actual: unknown, expected: unknown, result: boolean): boolean => {
  const state = current.getStore()
  if (state && !state.ended) {
    const compared = (state.compared ??= { calls: [], more: 0 })
    if (compared.calls.length < MAX_COMPARED) compared.calls.push({ name, actual, expected, result })
    else compared.more++
  }
  return result
}
