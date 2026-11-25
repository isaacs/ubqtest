// The state of the test that is running.
import { AsyncLocalStorage } from 'node:async_hooks'
import type { Coverage, Failure, TestId } from './events.ts'
import type { TestContext, TestOptions } from './test.ts'

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
  /**
   * The calls of `isDeepEqual`, `isMatch`, and `isMatchOnly` after
   * the last assertion, and the count of the calls that are not in
   * the list.
   */
  compared?: {
    calls: {
      name: 'isDeepEqual' | 'isMatch' | 'isMatchOnly'
      actual: unknown
      expected: unknown
      result: boolean
    }[]
    more: number
  }
  /** Results of `assert.rejects` that nothing awaited yet. */
  unawaited: Set<object>
  /** Functions from fixtures. They run in reverse order when the test ends. */
  cleanups: (() => void | Promise<void>)[]
  /** `testdir` folders that stay because the test failed. */
  kept: string[]
  /** Records a failure and stops the wait for the test function. */
  fail: (failure: Failure) => void
}

type Cleanups = ((() => void | Promise<void>) & { limit?: number })[]

/** A `describe` group, or the file: `root`. */
export interface Group {
  /** The names of the group and of the groups around it, outermost first. */
  path: string[]
  options: TestOptions
  beforeAll: (() => unknown)[]
  afterAll: (() => unknown)[]
  beforeEach: ((ctx: TestContext) => unknown)[]
  afterEach: ((ctx: TestContext) => unknown)[]
  /** Functions from fixtures of a `beforeAll`. They run when the group ends. */
  cleanups: Cleanups
  /** True after the `beforeAll` hooks ran: a test of the group ran. */
  started: boolean
  /** True after the `afterAll` hooks ran. */
  ended: boolean
  /** The failure of a `beforeAll` hook. Each test of the group has it. */
  failure?: Failure
}

interface Shared {
  current: AsyncLocalStorage<TestState>
  fileCleanups: Cleanups
  coverage: Coverage['files']
  groups: Group[]
  root: Group
  hook: { group?: Group }
}
// `ubqtest/browser` is a separate file of the built package, with
// its own copy of this module. The two copies must have the same
// state.
const KEY = Symbol.for('ubqtest.state')
/** A new group with no hooks. */
export const makeGroup = (path: string[], options: TestOptions, cleanups: Cleanups = []): Group => ({
  path,
  options,
  beforeAll: [],
  afterAll: [],
  beforeEach: [],
  afterEach: [],
  cleanups,
  started: false,
  ended: false,
})
const makeShared = (): Shared => {
  const fileCleanups: Cleanups = []
  return {
    current: new AsyncLocalStorage<TestState>(),
    fileCleanups,
    coverage: [],
    groups: [],
    // A fixture of a `beforeAll` of the file lasts until the file ends.
    root: makeGroup([], {}, fileCleanups),
    hook: {},
  }
}
const shared = ((globalThis as { [KEY]?: Shared })[KEY] ??= makeShared())

/** The test that owns the code that runs now, through all its async work. */
export const current = shared.current
/** The `describe` groups whose function runs now, outermost first. */
export const groups = shared.groups
/** The file as a group: the hooks at the top level of the file. */
export const root = shared.root
/** `group` is set while a `beforeAll` or an `afterAll` hook of that group runs. */
export const hook = shared.hook
/** Cleanup functions from fixture calls outside a test. They run when the file ends. */
export const fileCleanups = shared.fileCleanups
/**
 * Coverage of the current test from a place that is not this
 * process, such as a page of a browser. It goes into the next
 * `coverage` event.
 */
export const moreCoverage = shared.coverage
