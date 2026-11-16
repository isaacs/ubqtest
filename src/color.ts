// Color for a person at a terminal (D75): red for a fail, cyan for a
// pass. Not green: many people see red and green as near the same
// color. No color in CI, or when stdout is not a terminal.
const on = (): boolean => !!process.stdout.isTTY && !process.env.CI

/** The word `FAIL`, `fail`, or `pass`, in its color. Other words as they are. */
export const paint = (word: string): string =>
  !on()
    ? word
    : word === 'FAIL' || word === 'fail'
      ? `\x1b[40;31m${word}\x1b[m`
      : word === 'pass'
        ? `\x1b[40;36m${word}\x1b[m`
        : word
