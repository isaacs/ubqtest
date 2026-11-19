// Code with timers, for the tests with a fake clock.
export const debounce = <A extends unknown[]>(fn: (...args: A) => void, ms: number): ((...args: A) => void) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  return (...args) => {
    clearTimeout(timer)
    timer = setTimeout(fn, ms, ...args)
  }
}

/** Calls `fn` each `ms` until it returns true. Returns the function that stops it. */
export const poll = (fn: () => boolean, ms: number): (() => void) => {
  const timer = setInterval(() => {
    if (fn()) clearInterval(timer)
  }, ms)
  return () => clearInterval(timer)
}

export const stamp = (): string => new Date().toISOString()
