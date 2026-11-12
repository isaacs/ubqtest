// The state of the test that is running.
import { AsyncLocalStorage } from 'node:async_hooks'
import type { Failure, TestId } from './events.ts'

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

/** The test that owns the code that runs now, through all its async work. */
export const current = new AsyncLocalStorage<TestState>()
