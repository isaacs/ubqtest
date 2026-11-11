// `test`, `describe`, and the loop that runs tests one at a time.
// See docs/05-api.md, sections 3 and 4.
import { Worker } from 'node:worker_threads'
import { AssertionFailure } from './assert.ts'
import type { Collector } from './coverage.ts'
import { emit } from './emit.ts'
import { EVENT_VERSION, type Failure, type Location } from './events.ts'
import { type Hint, hint } from './hint.ts'
import { rel } from './project.ts'
import { callSite, userFrames } from './stack.ts'
import { current, type TestState } from './state.ts'
import type { WatchData, WatchMessage } from './watchdog.ts'

export interface TestContext {
  /** Aborts when the test times out. */
  readonly signal: AbortSignal
}

export interface TestOptions {
  /** The reason to skip the test. `false` runs the test. */
  skip?: string | false
  /** Milliseconds. The default is 5000. */
  timeout?: number
}

export type TestFn = (ctx: TestContext) => void | Promise<void>

export interface Test {
  (name: string, fn: TestFn): void
  (name: string, options: TestOptions, fn: TestFn): void
  skip: Hint<'Use test(name, { skip: "reason" }, fn)'>
  todo: Hint<'Use test(name, { skip: "todo: reason" }, fn)'>
  only: Hint<'ubq has no .only. Select tests on the command line: ubq <file>:<line>'>
  each: Hint<'Use a for loop around test()'>
}

export interface Describe {
  (name: string, fn: () => void): void
  (name: string, options: TestOptions, fn: () => void): void
}

const DEFAULT_TIMEOUT = 5000
/** The path of this test file, if the runner gave it. */
const FILE = process.env.UBQ_FILE
/** True if the process is a child of the runner. */
const CHILD = !!process.env.UBQ_CHILD
const SEPARATOR = ' > '

interface Entry {
  id: string
  fn: TestFn
  skip: string | false
  timeout: number
  at: Location | undefined
}

const queue: Entry[] = []
const groups: { name: string; options: TestOptions }[] = []
const ids = new Set<string>()
let file: string | undefined
let scheduled = false
let finished = false
/** The test that runs now. */
let active: TestState | undefined
let collector: Collector | undefined

/** Sets the coverage collector. Call it before the first test runs. */
export const setCollector = (c: Collector | undefined): void => {
  collector = c
}

/** Emits a `coverage` event for the code that ran since the last one. */
const cover = async (id?: string): Promise<void> => {
  if (!collector) return
  const files = await collector.take()
  if (files.length) emit({ type: 'coverage', tfile: currentFile(), ...(id && { id }), files })
}

const checkName = (kind: string, name: unknown): void => {
  if (typeof name !== 'string' || !name)
    throw new TypeError(`${kind} name must be a string that is not empty`)
  if (name.includes(SEPARATOR))
    throw new TypeError(
      `${kind} name must not contain "${SEPARATOR}": ${JSON.stringify(name)}`,
    )
}

const testFn = (name: string, a: TestOptions | TestFn, b?: TestFn): void => {
  const [options, fn] = typeof a === 'function' ? [{}, a] : [a, b]
  if (current.getStore())
    throw new Error(
      'test() was called inside a running test. Put each test at the top level or in describe().',
    )
  checkName('test', name)
  if (typeof fn !== 'function')
    throw new TypeError(`test ${JSON.stringify(name)} has no function`)
  const at = callSite()
  file ??= FILE || at?.file || rel(process.argv[1] ?? '')
  const id = [file, ...groups.map(g => g.name), name].join(SEPARATOR)
  if (ids.has(id))
    throw new Error(`duplicate test name: ${id}. Each name must be unique in its group.`)
  ids.add(id)
  const all = [...groups.map(g => g.options), options]
  if (at) starts.push(at.line)
  queue.push({
    id,
    fn,
    skip: all.find(o => o.skip)?.skip ?? false,
    timeout: all.findLast(o => o.timeout !== undefined)?.timeout ?? DEFAULT_TIMEOUT,
    at,
  })
  if (!scheduled) {
    scheduled = true
    setImmediate(drain)
  }
}

export const test: Test = Object.assign(testFn, {
  skip: hint('Use test(name, { skip: "reason" }, fn)'),
  todo: hint('Use test(name, { skip: "todo: reason" }, fn)'),
  only: hint('ubq has no .only. Select tests on the command line: ubq <file>:<line>'),
  each: hint('Use a for loop around test()'),
})

export const describe: Describe = (
  name: string,
  a: TestOptions | (() => void),
  b?: () => void,
): void => {
  const [options, fn] = typeof a === 'function' ? [{}, a] : [a, b]
  if (current.getStore())
    throw new Error('describe() was called inside a running test.')
  checkName('describe', name)
  if (typeof fn !== 'function')
    throw new TypeError(`describe ${JSON.stringify(name)} has no function`)
  groups.push({ name, options })
  try {
    const result: unknown = fn()
    if (result instanceof Promise)
      throw new TypeError(
        `the function of describe ${JSON.stringify(name)} must not be async. Await at the top level of the file, before describe().`,
      )
  } finally {
    groups.pop()
  }
}

// The source is `.ts`, and the bundle is `.js`.
const WATCHDOG = new URL(
  import.meta.url.endsWith('.ts') ? './watchdog.ts' : './watchdog.js',
  import.meta.url,
)
let watchdog: Worker | undefined
const watch = (message: WatchMessage): void => watchdog?.postMessage(message)

/** The path of the test file. Known after the first `test()` call. */
export const currentFile = (): string => file ?? FILE ?? rel(process.argv[1] ?? '')

let started = false
const start = (): void => {
  if (started) return
  started = true
  // The runner watches its children. A process with no runner
  // watches itself.
  if (!CHILD) {
    const data: WatchData = { file: currentFile(), unselected: 0 }
    watchdog = new Worker(WATCHDOG, { workerData: data })
    watchdog.unref()
  }
  openAtStart = openNow()
  file ??= FILE || rel(process.argv[1] ?? '')
  emit({
    type: 'file-start',
    v: EVENT_VERSION,
    file,
    pid: process.pid,
    coverage: collector?.mode ?? 'none',
  })
}

const errorFailure = (error: unknown): Failure => {
  if (error instanceof AssertionFailure) return error.failure
  const isError = error instanceof Error
  const stack = userFrames(isError ? error.stack : undefined)
  return {
    kind: 'error',
    message:
      isError ? `${error.name}: ${error.message}` : `threw ${String(error)}`,
    ...(stack[0] && { at: stack[0], stack }),
  }
}

const TIMEOUT = Symbol('timeout')

/** Counts of what keeps the process alive now, by type. */
const openNow = (): Map<string, number> => {
  const counts = new Map<string, number>()
  for (const type of process.getActiveResourcesInfo())
    counts.set(type, (counts.get(type) ?? 0) + 1)
  return counts
}

// The stdio pipes of the process, and all that was open before the
// first test. These are not a fault of a test.
let openAtStart = new Map<string, number>()

/** What was opened after `before`, as `Type` or `Type xN`. */
const stillOpen = (before = openAtStart): string[] =>
  [...openNow()].flatMap(([type, n]) => {
    const more = n - (before.get(type) ?? 0)
    return (
      more > 1 ? [`${type} x${more}`]
      : more === 1 ? [type]
      : []
    )
  })

const runOne = async (entry: Entry): Promise<void> => {
  emit({
    type: 'test-start',
    id: entry.id,
    timeout: entry.timeout,
    ...(entry.at && { at: entry.at }),
  })
  if (entry.skip) {
    watch({ end: 'skip' })
    emit({
      type: 'test-end',
      id: entry.id,
      status: 'skip',
      ms: 0,
      asserts: 0,
      reason: entry.skip,
    })
    return
  }
  let stop!: (reason: unknown) => void
  const stopped = new Promise<never>((_, reject) => (stop = reject))
  stopped.catch(() => {})
  const state: TestState = {
    id: entry.id,
    asserts: 0,
    ended: false,
    late: false,
    unawaited: new Set(),
    fail: failure => {
      state.failure ??= failure
      stop(failure)
    },
  }
  let controller: AbortController | undefined
  const ctx: TestContext = {
    get signal() {
      return (controller ??= new AbortController()).signal
    },
  }
  active = state
  watch({ start: entry.id, timeout: entry.timeout, ...(entry.at && { at: entry.at }) })
  const before = openNow()
  const t0 = performance.now()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = current.run(state, entry.fn, ctx)
    if (result instanceof Promise) {
      // Not a reason to stay alive: if nothing else is pending,
      // `beforeExit` reports that the promise can never settle.
      timer = setTimeout(stop, entry.timeout, TIMEOUT).unref()
      await Promise.race([result, stopped])
    }
  } catch (error) {
    if (error === TIMEOUT) {
      const pending = stillOpen(before)
      state.failure ??= {
        kind: 'timeout',
        message: `the test did not end in ${entry.timeout} ms`,
        ...(entry.at && { at: entry.at }),
        ...(pending.length && { pending }),
      }
      controller?.abort(new Error('test timed out'))
    } else state.failure ??= errorFailure(error)
  }
  clearTimeout(timer)
  const ms = performance.now() - t0
  state.ended = true
  active = undefined
  if (!state.failure && state.unawaited.size)
    state.failure = {
      kind: 'not-awaited',
      message: 'assert.rejects was not awaited. Write: await assert.rejects(...)',
      ...(entry.at && { at: entry.at }),
    }
  if (!state.failure && state.asserts === 0)
    state.failure = {
      kind: 'no-assertions',
      message: 'the test ran no assertions',
      ...(entry.at && { at: entry.at }),
    }
  watch({ end: state.failure ? 'fail' : 'pass' })
  emit({
    type: 'test-end',
    id: entry.id,
    status: state.failure ? 'fail' : 'pass',
    ms,
    asserts: state.asserts,
    ...(state.failure && { failure: state.failure }),
  })
  await cover(entry.id)
}

// Lines from `ubq <file>:<line>`. A line selects the test that
// starts at or before it and is nearest to it.
const lines = (process.env.UBQ_LINES ?? '').split(',').filter(Boolean).map(Number)
// Test IDs from `ubq '<test id>'`. The ID of a group selects all
// tests in the group.
const wanted = JSON.parse(process.env.UBQ_IDS || '[]') as string[]
const starts: number[] = []
let unselected = 0
const selected = (entry: Entry): boolean => {
  if (!lines.length && !wanted.length) return true
  const line = entry.at?.line ?? 0
  return (
    lines.some(l => line <= l && !starts.some(s => s > line && s <= l)) ||
    wanted.some(id => entry.id === id || entry.id.startsWith(id + SEPARATOR))
  )
}

let draining = false
const drain = async (): Promise<void> => {
  if (draining) return
  draining = true
  if (!started) {
    start()
    // The code that ran while the file loaded.
    await cover()
  }
  for (let entry = queue.shift(); entry; entry = queue.shift()) {
    if (selected(entry)) await runOne(entry)
    else unselected++
  }
  draining = false
  scheduled = false
  // This timer does not keep the process alive. It fires only if
  // something else does.
  idle ??= setTimeout(leaked, IDLE_MS).unref()
}

const IDLE_MS = 1000
let idle: ReturnType<typeof setTimeout> | undefined

// The tests ended, but the process did not exit.
const leaked = (): void => {
  idle = undefined
  if (finished || draining || queue.length) return
  finished = true
  const pending = stillOpen()
  emit({
    type: 'file-error',
    file: file!,
    failure: {
      kind: 'error',
      message:
        'the tests ended, but the process did not exit. Something that a test or the file opened is still open. Close it in the test that opened it.',
      ...(pending.length && { pending }),
    },
  })
  emit({ type: 'file-end', file: file!, unselected })
  process.exit()
}

// An error that nothing caught belongs to the test that runs now.
// With no test, it belongs to the file.
const stray = (error: unknown): void => {
  if (active) return active.fail(errorFailure(error))
  if (error instanceof AssertionFailure) return
  start()
  emit({ type: 'file-error', file: file!, failure: errorFailure(error) })
}
process.on('uncaughtException', stray)
process.on('unhandledRejection', stray)

// The code under test called `process.exit`. Without this, the
// process would end with no summary, and code 0 would look like a
// pass.
process.on('exit', code => {
  if (finished) return
  finished = true
  start()
  emit({
    type: 'file-error',
    file: file!,
    failure: {
      kind: 'error',
      message: `process.exit(${code}) was called before the tests ended${active ? `, in test: ${active.id}` : ''}`,
    },
  })
  emit({ type: 'file-end', file: file!, unselected })
})

// `beforeExit` means that the process has no more work, so no more
// tests can arrive.
process.on('beforeExit', () => {
  // The process has no more work, but a test is open: its promise
  // can never settle. The failure lets the next test start.
  if (active && !active.ended)
    return active.fail({
      kind: 'never-settled',
      message:
        'the promise of the test never settled, and nothing is pending. A callback or an event that the test waits for never came.',
    })
  if (finished || draining || queue.length) return
  finished = true
  start()
  if (!ids.size || unselected === ids.size)
    emit({
      type: 'file-error',
      file: file!,
      failure: {
        kind: 'no-tests',
        message:
          !ids.size ? 'the file registered no tests'
          : wanted.length ?
            `no test of this file has an ID in the selection. The IDs in this file are:\n${[...ids].join('\n')}`
          : `no test starts at or before line ${lines.join(', ')} of this file`,
      },
    })
  emit({ type: 'file-end', file: file!, unselected })
})
