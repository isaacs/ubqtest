// Color for a person at a terminal (D75): red for a fail, cyan for a
// pass. Not green: many people see red and green as near the same
// color. No color in CI, with NO_COLOR or FORCE_COLOR=0, or when
// stdout is not a terminal.
const on = (): boolean =>
  !!process.stdout.isTTY && !process.env.CI && !process.env.NO_COLOR && process.env.FORCE_COLOR !== '0'

/** The words in red. The site colors the same words. */
const RED = new Set(['FAIL', 'ERROR', 'TYPE', 'SURVIVED', 'fail'])

/** A word in its color: red for a failure, cyan for `pass`. Other words as they are. */
export const paint = (word: string): string =>
  !on() ? word : RED.has(word) ? `\x1b[40;31m${word}\x1b[m` : word === 'pass' ? `\x1b[40;36m${word}\x1b[m` : word
