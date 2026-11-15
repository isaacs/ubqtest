/**
 * Calls `fn` until its promise resolves, `tries` times at most, and
 * resolves to its value. Rejects with the last error. A count of
 * tries below 1 rejects with a `RangeError`.
 */
export const retry = <T>(fn: () => Promise<T>, tries: number): Promise<T> =>
  new Promise((resolve, reject) => {
    if (tries < 1) return reject(new RangeError(`tries must be 1 or more: ${tries}`))
    const attempt = (left: number): void => {
      fn().then(resolve, error => (left === 1 ? reject(error) : attempt(left - 1)))
    }
    attempt(tries)
  })
