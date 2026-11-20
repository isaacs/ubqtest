// The built-in functions for a pattern. See docs/05-api.md, section 5.
import { diffDeep, show } from './format.ts'

/** A function in a pattern: it tests the value at its place. */
type Predicate = (value: unknown) => boolean

/**
 * A predicate that a failure shows by its name, not by its code:
 * as the text of the function, and in a value that `inspect`
 * prints, such as the arguments of `any.arrayWith`.
 */
const named = (name: string, test: Predicate): Predicate =>
  Object.defineProperties(test, {
    toString: { value: () => name },
    [Symbol.for('nodejs.util.inspect.custom')]: { value: () => name },
  })

const type = (name: string): Predicate => named(`any.${name}`, value => typeof value === name)

/**
 * Functions for a pattern of `assert.match`, `assert.matchOnly`,
 * `isMatch`, and the other places that take a pattern. Each one
 * tests the value at its place.
 *
 * ```ts
 * assert.matchOnly(event, { id: any.number, at: any.instanceOf(Date) })
 * assert.match(res, { rows: any.arrayWith({ id: 7 }) })
 * ```
 */
export const any = {
  number: type('number'),
  string: type('string'),
  boolean: type('boolean'),
  bigint: type('bigint'),
  symbol: type('symbol'),
  function: type('function'),
  /** An object or an array. Not `null`, and not a function. */
  object: named('any.object', value => typeof value === 'object' && value !== null),
  array: named('any.array', value => Array.isArray(value)),
  /** Each value but `null` and `undefined`. */
  defined: named('any.defined', value => value != null),
  /** A value that is an instance of the class. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  instanceOf: (type: abstract new (...args: any[]) => unknown): Predicate =>
    named(`any.instanceOf(${type.name})`, value => value instanceof type),
  /**
   * An array that has, for each pattern, an element that matches
   * it by the rules of `assert.match`: an object in a pattern is
   * partial. The array can have other elements, in each order.
   */
  arrayWith: (...patterns: unknown[]): Predicate =>
    named(
      `any.arrayWith(${patterns.map(show).join(', ')})`,
      value =>
        Array.isArray(value) &&
        patterns.every(pattern => value.some(element => !diffDeep(element, pattern, true).diffs.length)),
    ),
}
