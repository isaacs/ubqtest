// The state of the test that is running.
import { AsyncLocalStorage } from 'node:async_hooks'
import type { Coverage, Failure, TestId } from './events.ts'

export interface TestState {
  id: TestId
  /** Count of assertions that ran. */
  asserts: number
  /** The first failure. Later ones are dropped. */
  failure?: Failure
  /** True after `test-end`. */
  ended: boolean
  /** True after one `late-failure` event for this test. */
  late: boolean
  /** Results of `assert.rejects` that nothing awaited yet. */
  unawaited: Set<object>
  /** Functions from fixtures. They run in reverse order when the test ends. */
  cleanups: (() => void | Promise<void>)[]
  /** `testdir` folders that stay because the test failed. */
  kept: string[]
  /** Records a failure and stops the wait for the test function. */
  fail: (failure: Failure) => void
}

interface Shared {
  current: AsyncLocalStorage<TestState>
  fileCleanups: (() => void | Promise<void>)[]
  coverage: Coverage['files']
}
// `ubqtest/browser` is a separate file of the built package, with
// its own copy of this module. The two copies must have the same
// state.
const KEY = Symbol.for('ubqtest.state')
const shared = ((globalThis as { [KEY]?: Shared })[KEY] ??= { current: new AsyncLocalStorage<TestState>(), fileCleanups: [], coverage: [] })

/** The test that owns the code that runs now, through all its async work. */
export const current = shared.current
/** Cleanup functions from fixture calls outside a test. They run when the file ends. */
export const fileCleanups = shared.fileCleanups
/**
 * Coverage of the current test from a place that is not this
 * process, such as a page of a browser. It goes into the next
 * `coverage` event.
 */
export const moreCoverage = shared.coverage
