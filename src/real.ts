// The real timers and clocks, taken before a test can replace them
// with a fake clock. The library must use these: the time limit of
// a test and the times in a report are real.
export const setTimeout = globalThis.setTimeout
export const clearTimeout = globalThis.clearTimeout
export const setImmediate = globalThis.setImmediate
const realNow = performance.now.bind(performance)
const dateNow = Date.now
/** Milliseconds from a fixed point, for durations. */
export const now = (): number => realNow()
/** Milliseconds since 1970. */
export const time = (): number => dateNow()
