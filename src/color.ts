// Color for a person at a terminal (D75): red for a fail, cyan for a
// pass. Not green: many people see red and green as near the same
// color. No color in CI, with NO_COLOR or FORCE_COLOR=0, or when
// stdout is not a terminal.

/**
 * The run of a workspace prints through a pipe to the root run, which
 * is at a terminal (D140). A test process must not get the variable.
 */
const root = process.env.UBQ_COLOR === '1'
delete process.env.UBQ_COLOR

export const colors = (): boolean =>
  (root || !!process.stdout.isTTY) && !process.env.CI && !process.env.NO_COLOR && process.env.FORCE_COLOR !== '0'

/** The words in red. The site colors the same words. */
const RED = new Set(['FAIL', 'ERROR', 'TYPE', 'SURVIVED', 'fail'])

/** A word in its color: red for a failure, cyan for `pass`. Other words as they are. */
export const paint = (word: string): string =>
  !colors() ? word : RED.has(word) ? `\x1b[40;31m${word}\x1b[m` : word === 'pass' ? `\x1b[40;36m${word}\x1b[m` : word
