// `test`, `describe`, and the loop that runs tests one at a time.
// See docs/05-api.md, sections 3 and 4.
import { clearTimeout, now, setImmediate, setTimeout } from './real.ts'
import type { Worker } from 'node:worker_threads'
import { AssertionFailure } from './assert.ts'
import { readChildren } from './child-read.ts'
import { config } from './config.ts'
import { COLUMN, COUNTER_NAME } from './counters.ts'
import { type Collector, mergeRanges } from './coverage.ts'
import { emit } from './emit.ts'
import { type CleanupFn, fileCleanups, fileState } from './fixtures.ts'
import { EVENT_VERSION, type Failure, type Location } from './events.ts'
import { trackOpened } from './hang.ts'
import { type Hint, hint } from './hint.ts'
import { rel } from './project.ts'
import { saveSnapshots } from './snapshot.ts'
import { callSite, userFrames } from './stack.ts'
import { current, type Group, groups, hook, makeGroup, moreCoverage, root, type TestState } from './state.ts'
import { workerd } from './workerd.ts'
import type { WatchData, WatchMessage } from './watchdog.ts'

/** The argument of a test function. */
export interface TestContext {
  /** Aborts when the test times out. */
  readonly signal: AbortSignal
  /**
   * Ends the test as skipped, with the reason. For a condition
   * that the test knows only while it runs. A condition that is
   * known before is the `skip` option. A test that has a failure
   * at this point is a failure.
   *
   * ```ts
   * test('wraps long lines', async ({ skip }) => {
   *   const lines = await measure(page)
   *   if (lines < 3) skip('the page has no paragraph of three lines')
   *   assert.lessThan(width(page), 80)
   * })
   * ```
   */
  skip(reason: string): never
}

/**
 * The options of `test` and of `describe`. A group gives its options to
 * its tests.
 */
export interface TestOptions {
  /** The reason to skip the test. `false` runs the test. */
  skip?: string | false
  /**
   * The time limit of the test in milliseconds. The default is 5000, or
   * the `timeout` of the configuration.
   */
  timeout?: number
}

/** The function of a test. It can return a promise. */
export type TestFn = (ctx: TestContext) => void | Promise<void>

/** The type of `test`. */
export interface Test {
  (name: string, fn: TestFn): void
  (name: string, options: TestOptions, fn: TestFn): void
  skip: Hint<'Use test(name, { skip: "reason" }, fn)'>
  todo: Hint<'Use test(name, { skip: "todo: reason" }, fn)'>
  only: Hint<'ubq has no .only. Select tests on the command line: ubq <file>:<line>'>
  each: Hint<'Use a for loop around test()'>
}

/** The type of `describe`. */
export interface Describe {
  (name: string, fn: () => void): void
  (name: string, options: TestOptions, fn: () => void): void
}

const DEFAULT_TIMEOUT = 5000
/** The path of this test file, if the runner gave it. */
const FILE = process.env.UBQ_FILE
const host = workerd()
/** True if the process is a child of the runner. */
const CHILD = !!process.env.UBQ_CHILD
const SEPARATOR = ' > '

interface Entry {
  id: string
  fn: TestFn
  /** The file and the groups of the test, outermost first. */
  scopes: Group[]
  skip: string | false
  timeout: number
  at: Location | undefined
}

const queue: Entry[] = []
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
  const more = [...moreCoverage.splice(0), ...readChildren()]
  if (!collector) return
  const files = await collector.take()
  for (const extra of more) {
    const same = files.find(f => f.file === extra.file)
    if (same) same.ranges = mergeRanges(same.ranges, extra.ranges)
    else files.push(extra)
  }
  if (files.length) emit({ type: 'coverage', tfile: currentFile(), ...(id && { id }), files })
}

const checkName = (kind: string, name: unknown): void => {
  if (typeof name !== 'string' || !name) throw new TypeError(`${kind} name must be a string that is not empty`)
  if (name.includes(SEPARATOR))
    throw new TypeError(`${kind} name must not contain "${SEPARATOR}": ${JSON.stringify(name)}`)
}

/** Throws for an option that ubq does not have: a file that is not TypeScript has no check of the names. */
const checkOptions = (kind: string, name: string, options: object): void => {
  const unknown = Object.keys(options).find(key => key !== 'skip' && key !== 'timeout')
  if (unknown !== undefined)
    throw new TypeError(
      `${kind} ${JSON.stringify(name)} has the option ${JSON.stringify(unknown)}, which ubq does not have. The options are skip and timeout.` +
        (unknown === 'concurrency' ? ' The tests of a file run one at a time.' : ''),
    )
}

const testFn = (name: string, a: TestOptions | TestFn, b?: TestFn): void => {
  const [options, fn] = typeof a === 'function' ? [{}, a] : [a, b]
  if (current.getStore())
    throw new Error('test() was called inside a running test. Put each test at the top level or in describe().')
  if (fileState.ran)
    throw new Error(
      'test() was called after the cleanup functions of the file ran. Call test() with no await between the first call and the last call.',
    )
  checkName('test', name)
  if (typeof fn !== 'function') throw new TypeError(`test ${JSON.stringify(name)} has no function`)
  checkOptions('test', name, options)
  const at = callSite()
  // ubq: not measured: a call of test() from a file has a call site
  file ??= FILE || at?.file || rel(process.argv[1] ?? '')
  const id = [file, ...(groups.at(-1)?.path ?? []), name].join(SEPARATOR)
  if (ids.has(id)) {
    // The file does not stop here: one run shows each duplicate.
    failedOutside = true
    duplicates.push(errorFailure(new Error(`duplicate test name: ${id}. Each name must be unique in its group.`)))
    return
  }
  ids.add(id)
  const all = [...groups.map(g => g.options), options]
  if (at) starts.push(at.line)
  queue.push({
    id,
    fn,
    scopes: [root, ...groups],
    skip: all.find(o => o.skip)?.skip ?? false,
    timeout: Math.min(
      LIMIT,
      all.findLast(o => o.timeout !== undefined)?.timeout ?? config().timeout ?? DEFAULT_TIMEOUT,
    ),
    at,
  })
  if (!scheduled) {
    scheduled = true
    setImmediate(drain)
  }
}

/**
 * Defines a test. The tests of a file run one at a time, in the
 * order of the file, after the file loaded. A test passes if its
 * function ends, or its promise resolves, with no failed assertion
 * and no error. It must run one assertion or more.
 *
 * ```ts
 * test('adds two numbers', () => {
 *   assert.equal(add(1, 2), 3)
 * })
 * test('loads the user', { timeout: 10_000 }, async ({ signal }) => {
 *   assert.match(await load('ann', { signal }), { name: 'Ann' })
 * })
 * test('reads the log', { skip: !hasGit && 'git is not installed' }, () => {
 *   assert.contains(log(), 'first commit')
 * })
 * ```
 *
 * ubq has no `test.only` and no `test.each`. Select a test on the
 * command line (`ubq <file>:<line>`), and call `test` in a loop.
 */
export const test: Test = Object.assign(testFn, {
  skip: hint('Use test(name, { skip: "reason" }, fn)'),
  todo: hint('Use test(name, { skip: "todo: reason" }, fn)'),
  only: hint('ubq has no .only. Select tests on the command line: ubq <file>:<line>'),
  each: hint('Use a for loop around test()'),
})

/**
 * A group of tests. Its name is a part of the ID of each test in
 * it: `file > group > test`. `fn` runs while the file loads, and it
 * must not be async. The options are the default for each test of
 * the group.
 *
 * ```ts
 * describe('parse', () => {
 *   test('a circle', () => {
 *     assert.equal(parse('c')?.kind, 'circle')
 *   })
 * })
 * ```
 */
export const describe: Describe = (name: string, a: TestOptions | (() => void), b?: () => void): void => {
  const [options, fn] = typeof a === 'function' ? [{}, a] : [a, b]
  if (current.getStore()) throw new Error('describe() was called inside a running test.')
  checkName('describe', name)
  if (typeof fn !== 'function') throw new TypeError(`describe ${JSON.stringify(name)} has no function`)
  checkOptions('describe', name, options)
  groups.push(makeGroup([...(groups.at(-1)?.path ?? []), name], options))
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

type HookKind = 'beforeAll' | 'afterAll' | 'beforeEach' | 'afterEach'

/** Adds a hook to the group whose function runs now, or to the file. */
const addHook = <K extends HookKind>(kind: K, fn: Group[K][number], more: unknown[]): void => {
  if (current.getStore() || hook.group)
    throw new Error(
      `${kind}() was called inside a running test or hook. Call it at the top level of the file, or in the function of describe().`,
    )
  if (fileState.ran)
    throw new Error(
      `${kind}() was called after the last test of the file ran. Call it with no await between the first test() call and the last one.`,
    )
  if (typeof fn !== 'function') throw new TypeError(`${kind}() needs a function`)
  if (more.length)
    throw new TypeError(
      `${kind}() takes one argument, the function. A hook for each test has the time limit of the test. A hook for a group has the timeout option of the group.`,
    )
  ;((groups.at(-1) ?? root)[kind] as Group[K][number][]).push(fn)
}

/**
 * Runs `fn` before each test of the group that calls it, and of the
 * groups in it. At the top level of a file: before each test of the
 * file. The hooks of an outer group run first. `fn` is part of the
 * test: it gets the argument of the test function, it has the time
 * limit of the test, a fixture in it lasts until the test ends, and
 * a failure in it fails the test. A promise that it returns is
 * awaited. Any other result is not used.
 *
 * ```ts
 * let db: Db
 * beforeEach(async () => {
 *   db = await open(':memory:')
 *   cleanup(() => db.close())
 * })
 * test('adds a row', () => {
 *   db.add(1)
 *   assert.equal(db.count(), 1)
 * })
 * ```
 */
export const beforeEach = (fn: (ctx: TestContext) => unknown, ...more: never[]): void => addHook('beforeEach', fn, more)

/**
 * Runs `fn` after each test of the group that calls it, and of the
 * groups in it, also if the test failed. The hooks of an inner group
 * run first, and the hooks of one group run last first. They run
 * before the `cleanup` functions of the test. An assertion in `fn`
 * does not count for the rule that a test must run an assertion.
 *
 * ```ts
 * afterEach(() => {
 *   assert.deepEqual(errors, [])
 * })
 * ```
 */
export const afterEach = (fn: (ctx: TestContext) => unknown, ...more: never[]): void => addHook('afterEach', fn, more)

/**
 * Runs `fn` one time, before the first test of the group that
 * calls it. At the top level of a file: before the first test of
 * the file. It does not run if no test of the group runs. A
 * fixture in `fn` (`cleanup`, `env`, `testdir`, `spyOn`) lasts until
 * the group ends. If `fn` fails, each test of the group fails.
 *
 * ```ts
 * describe('the server', () => {
 *   let server: Server
 *   beforeAll(async () => {
 *     server = await listen(0)
 *     cleanup(() => server.close())
 *   })
 *   test('answers', async () => {
 *     assert.equal((await fetch(server.url)).status, 200)
 *   })
 * })
 * ```
 */
export const beforeAll = (fn: () => unknown, ...more: never[]): void => addHook('beforeAll', fn, more)

/**
 * Runs `fn` one time, after the last test of the group that calls
 * it. At the top level of a file: after the last test of the file.
 * It runs only if a test of the group ran. A failure in `fn` is an
 * error of the file.
 *
 * ```ts
 * afterAll(() => pool.end())
 * ```
 */
export const afterAll = (fn: () => unknown, ...more: never[]): void => addHook('afterAll', fn, more)

// The source is `.ts`, and the bundle is `.js`.
const WATCHDOG = new URL(import.meta.url.endsWith('.ts') ? './watchdog.ts' : './watchdog.js', import.meta.url)
let watchdog: Worker | undefined
const watch = (message: WatchMessage): void => watchdog?.postMessage(message)

/** The path of the test file. Known after the first `test()` call. */
// ubq: not measured: argv[1] is the test file in a plain run
export const currentFile = (): string => file ?? FILE ?? rel(process.argv[1] ?? '')

let started = false
const start = (): void => {
  if (started) return
  started = true
  // The runner watches its children. A process with no runner
  // watches itself.
  if (!CHILD) {
    const data: WatchData = {
      file: currentFile(),
      unselected: 0,
      counters: Symbol.for(COLUMN) in globalThis,
    }
    // Only this process loads the module: it takes time to load.
    const { Worker } = process.getBuiltinModule('node:worker_threads')
    watchdog = new Worker(WATCHDOG, { workerData: data })
    watchdog.unref()
  }
  openAtStart = openNow()
  // ubq: not measured: argv[1] is the test file in a plain run
  file ??= FILE || rel(process.argv[1] ?? '')
  emit({
    type: 'file-start',
    v: EVENT_VERSION,
    file,
    pid: process.pid,
    coverage: collector?.mode ?? 'none',
  })
}

/** What `skip()` of a test throws, to end the test function. */
const SKIP = Symbol('skip')

/** A hook that the file did not import, or a hook of an other test tool. */
const HOOK = /^(before|after)(Each|All)? is not defined$/
/** The text after such an error: the hook to import. */
const hookHint = (text: string): string => {
  const name = text.split(' ')[0]!
  const ours = /(Each|All)$/.test(name) ? name : `${name}All`
  return `. Import the hook: import { ${ours} } from 'ubqtest'.${ours === name ? '' : ` ${name} of node:test and mocha is ${ours} in ubq.`}`
}

const errorFailure = (error: unknown): Failure => {
  if (error instanceof AssertionFailure) return error.failure
  const isError = error instanceof Error
  const stack = userFrames(isError ? error.stack : undefined)
  // A message can have color codes of a terminal.
  const text = isError ? error.message.replace(/\x1b\[[\d;]*m/g, '') : ''
  return {
    kind: 'error',
    message: isError
      ? `${error.name}: ${text}` +
        (error.name === 'ReferenceError' && HOOK.test(text)
          ? hookHint(text)
          : text.includes(`${COUNTER_NAME} is not defined`)
            ? `\nhint: the text of a function has the coverage counters of ubq, and it ran in a place that has no counters. String(fn) and fn.toString() give the text with no counters. The toString of a different realm (node:vm, an iframe) does not: get the text in the realm of the test.`
            : '')
      : `threw ${String(error)}`,
    ...(stack[0] && { at: stack[0], stack }),
  }
}

/** For `ubq mutate`: no test has more time than this. A change can make a loop that does not end. */
const LIMIT = +(process.env.UBQ_LIMIT ?? Infinity)

const TIMEOUT = Symbol('timeout')

/** In a hang rerun: gives the places that opened what is still open. */
const opened = process.env.UBQ_HANG ? trackOpened(process.env.UBQ_HANG) : undefined

/** Counts of what keeps the process alive now, by type. */
const openNow = (): Map<string, number> => {
  const counts = new Map<string, number>()
  // workerd cannot list what is open.
  if (workerd()) return counts
  for (const type of process.getActiveResourcesInfo()) counts.set(type, (counts.get(type) ?? 0) + 1)
  return counts
}

// The stdio pipes of the process, and all that was open before the
// first test. These are not a fault of a test.
let openAtStart = new Map<string, number>()

/** What was opened after `before`, as `Type` or `Type xN`. */
const stillOpen = (before = openAtStart): string[] =>
  [...openNow()].flatMap(([type, n]) => {
    const more = n - (before.get(type) ?? 0)
    return more > 1 ? [`${type} x${more}`] : more === 1 ? [type] : []
  })

/**
 * Runs cleanup functions, last first. Each one has `timeout`
 * milliseconds. Returns the first failure.
 */
const runCleanups = async <F extends CleanupFn | ((ctx: TestContext) => unknown)>(
  fns: F[],
  timeout: number,
  call: (fn: F) => unknown,
  what = 'a cleanup function',
): Promise<Failure | undefined> => {
  let failure: Failure | undefined
  for (let fn = fns.pop(); fn; fn = fns.pop()) {
    let timer: ReturnType<typeof setTimeout> | undefined
    const limit = (fn as CleanupFn).limit ?? timeout
    try {
      const result = call(fn)
      if (result instanceof Promise)
        await Promise.race([
          result,
          // This timer keeps the process alive. With no timer, a
          // promise that never settles lets the process end, with no
          // report of the cleanup function.
          new Promise((_, reject) => (timer = setTimeout(reject, limit, TIMEOUT))),
        ])
    } catch (error) {
      const cause = error === TIMEOUT ? undefined : errorFailure(error)
      failure ??= {
        // An assertion in a cleanup function: its values and its diff.
        ...cause,
        kind: 'cleanup',
        message: cause ? `${what} failed: ${cause.message}` : `${what} did not end in ${limit} ms`,
        ...(cause?.at && { at: cause.at, stack: cause.stack }),
      }
    }
    clearTimeout(timer)
  }
  return failure
}

/**
 * Puts back the environment variables and the working directory
 * that a test changed. Returns a message if it changed one.
 */
const restore = (envBefore: NodeJS.ProcessEnv, cwdBefore: string): string | undefined => {
  const changed: string[] = []
  const now = { ...process.env }
  for (const name in now)
    if (now[name] !== envBefore[name]) {
      changed.push(name)
      if (name in envBefore) process.env[name] = envBefore[name]
      else delete process.env[name]
    }
  for (const name in envBefore)
    if (!(name in now)) {
      changed.push(name)
      process.env[name] = envBefore[name]
    }
  const cwd = process.cwd()
  if (cwd !== cwdBefore) process.chdir(cwdBefore)
  if (changed.length)
    return `the test changed the environment variable ${changed.sort().join(', ')} and did not put it back. Use env({ ${changed[0]}: value }): it puts the old value back when the test ends.`
  if (cwd !== cwdBefore)
    return `the test changed the working directory to ${cwd} and did not put it back. Put it back with cleanup(): const old = process.cwd(); cleanup(() => process.chdir(old))`
  return undefined
}

/** The time limit of the hooks of a group: its `timeout` option, or that of a group around it. */
const groupLimit = (group: Group, scopes: Group[]): number =>
  Math.min(
    LIMIT,
    scopes.slice(0, scopes.indexOf(group) + 1).findLast(g => g.options.timeout !== undefined)?.options.timeout ??
      config().timeout ??
      DEFAULT_TIMEOUT,
  )

/** `the file`, or `the group a > b`. */
const groupName = (group: Group): string => (group === root ? 'the file' : `the group ${group.path.join(SEPARATOR)}`)

/** Runs the `beforeAll` hooks of each group of a test that did not start. */
const startGroups = async (scopes: Group[]): Promise<void> => {
  for (const group of scopes) {
    if (group.started) continue
    group.started = true
    if (!group.beforeAll.length) continue
    hook.group = group
    // The hooks run first to last. `runCleanups` runs the last one first.
    const fns = [...group.beforeAll].reverse()
    const failure = await runCleanups(fns, groupLimit(group, scopes), fn => fn(), `beforeAll of ${groupName(group)}`)
    hook.group = undefined
    if (failure) group.failure = { ...failure, kind: 'error' }
    // The code of the hooks is code of each test of the group.
    await cover()
    // A group in a group that did not start has no state to use.
    if (failure) return
  }
}

/**
 * Runs the `afterAll` hooks and the cleanup functions of each group
 * of `scopes` that has no more tests to run. Not for the file: it
 * can get more tests.
 */
const endGroups = async (scopes: Group[]): Promise<void> => {
  for (const group of [...scopes].reverse()) {
    if (group === root || !group.started || group.ended) continue
    if (queue.some(entry => !entry.skip && entry.scopes.includes(group) && selected(entry))) continue
    await endGroup(group, scopes)
  }
}

const endGroup = async (group: Group, scopes: Group[]): Promise<void> => {
  group.ended = true
  if (!group.afterAll.length && !group.cleanups.length) return
  const limit = groupLimit(group, scopes)
  hook.group = group
  // Not if no test of the group ran: its beforeAll hooks did not run.
  const hooks = group.started ? [...group.afterAll] : []
  const failed = await runCleanups(hooks, limit, fn => fn(), `afterAll of ${groupName(group)}`)
  // The fixtures of the group go away also if a hook failed.
  const failure = [failed, await runCleanups(group.cleanups, limit, fn => fn())].find(Boolean)
  hook.group = undefined
  if (failure) emit({ type: 'file-error', file: file!, failure })
  await cover()
}

const runOne = async (entry: Entry): Promise<void> => {
  if (!entry.skip) await startGroups(entry.scopes)
  emit({
    type: 'test-start',
    id: entry.id,
    timeout: entry.timeout,
    ...(entry.at && { at: entry.at }),
  })
  // The runner must know that the test started before the test can
  // block the thread. On other runtimes the write of an event is sync.
  await host?.flush()
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
  ran.add(entry.id)
  const broken = entry.scopes.find(group => group.failure)?.failure
  if (broken) {
    watch({ end: 'fail' })
    emit({ type: 'test-end', id: entry.id, status: 'fail', ms: 0, asserts: 0, failure: broken })
    return endGroups(entry.scopes)
  }
  const before = entry.scopes.flatMap(group => group.beforeEach)
  /** The count of assertions when the test function started. */
  let inHooks = 0
  // A test with no hook runs as before: a function that does not
  // await runs with no turn of the event loop.
  const body: TestFn = before.length
    ? async ctx => {
        for (const fn of before) await fn(ctx)
        inHooks = state.asserts
        await entry.fn(ctx)
      }
    : entry.fn
  let stop!: (reason: unknown) => void
  const stopped = new Promise<never>((_, reject) => (stop = reject))
  stopped.catch(() => {})
  const state: TestState = {
    id: entry.id,
    asserts: 0,
    ended: false,
    late: false,
    unawaited: new Set(),
    cleanups: [],
    kept: [],
    fail: failure => {
      state.failure ??= failure
      stop(failure)
    },
  }
  const envBefore = { ...process.env }
  const cwdBefore = process.cwd()
  let controller: AbortController | undefined
  /** The reason of a `skip()` call of the test. */
  let skipped: string | undefined
  const ctx: TestContext = {
    get signal() {
      return (controller ??= new AbortController()).signal
    },
    skip(reason) {
      if (typeof reason !== 'string' || !reason) throw new TypeError('skip() needs the reason, as text')
      skipped = reason
      throw SKIP
    },
  }
  active = state
  watch({ start: entry.id, timeout: entry.timeout, ...(entry.at && { at: entry.at }) })
  const openBefore = openNow()
  const t0 = now()
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = current.run(state, body, ctx)
    if (result instanceof Promise) {
      // Not a reason to stay alive: if nothing else is pending,
      // `beforeExit` reports that the promise can never settle.
      timer = setTimeout(stop, entry.timeout, TIMEOUT).unref()
      await Promise.race([result, stopped])
    }
  } catch (error) {
    if (error === TIMEOUT) {
      const pending = stillOpen(openBefore)
      opened?.(pending)
      state.failure ??= {
        kind: 'timeout',
        message: `the test did not end in ${entry.timeout} ms`,
        ...(entry.at && { at: entry.at }),
        ...(pending.length && { pending }),
      }
      controller?.abort(new Error('test timed out'))
    } else if (error !== SKIP) state.failure ??= errorFailure(error)
  }
  clearTimeout(timer)
  // A timer cannot stop a function that does not await. The limit
  // is the same for it.
  const took = Math.round(now() - t0)
  if (!state.failure && took > entry.timeout)
    state.failure = {
      kind: 'timeout',
      message: `the test ended after ${took} ms, and its time limit is ${entry.timeout} ms. If the test needs this time, give it a limit: test(name, { timeout: ms }, fn)`,
      ...(entry.at && { at: entry.at }),
    }
  if (!state.failure && state.unawaited.size)
    state.failure = {
      kind: 'not-awaited',
      message: 'assert.rejects was not awaited. Write: await assert.rejects(...)',
      ...(entry.at && { at: entry.at }),
    }
  if (!state.failure && state.asserts === inHooks && skipped === undefined)
    state.failure = {
      kind: 'no-assertions',
      message: 'the test ran no assertions',
      ...(entry.at && { at: entry.at }),
    }
  // The afterEach hooks: those of the inner group first, and the
  // last one of a group first.
  const after = entry.scopes.flatMap(group => group.afterEach)
  if (after.length) {
    const failure = await runCleanups(after, entry.timeout, fn => current.run(state, fn, ctx), 'afterEach')
    if (failure) state.failure ??= { ...failure, ...(!failure.at && entry.at && { at: entry.at }) }
  }
  // The fixtures of the test. A `testdir` folder stays if the test
  // has a failure at this point.
  const failure = await runCleanups(state.cleanups, entry.timeout, fn => current.run(state, fn))
  if (failure) state.failure ??= { ...failure, ...(!failure.at && entry.at && { at: entry.at }) }
  // The test must leave the process as it found it (D29). The old
  // values come back, so that the next test is not affected.
  const leak = restore(envBefore, cwdBefore)
  if (leak) state.failure ??= { kind: 'leak', message: leak, ...(entry.at && { at: entry.at }) }
  const ms = now() - t0
  state.ended = true
  active = undefined
  const status = state.failure ? 'fail' : skipped === undefined ? 'pass' : 'skip'
  watch({ end: status })
  emit({
    type: 'test-end',
    id: entry.id,
    status,
    ms,
    asserts: state.asserts,
    ...(status === 'skip' && { reason: skipped }),
    // A failure with no place of its own has the place of its test()
    // call: a value that is not an error has no stack, and Bun gives
    // no place for a failure in a body that is one expression.
    ...(state.failure && { failure: { ...(entry.at && { at: entry.at }), ...state.failure } }),
    ...(state.kept.length && { kept: state.kept }),
  })
  await cover(entry.id)
  await endGroups(entry.scopes)
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
  // ubq: not measured: each test has a call site
  const line = entry.at?.line ?? 0
  return (
    lines.some(l => line <= l && !starts.some(s => s > line && s <= l)) ||
    wanted.some(id => entry.id === id || entry.id.startsWith(id + SEPARATOR))
  )
}

/** The errors of tests with the name of a test before them. */
const duplicates: Failure[] = []

let draining = false
const drain = async (): Promise<void> => {
  // ubq: not measured: drain does not start two times in the tests
  if (draining) return
  draining = true
  if (!started) {
    start()
    // The code that ran while the file loaded.
    await cover()
  }
  for (const failure of duplicates.splice(0)) emit({ type: 'file-error', file: file!, failure })
  for (let entry = queue.shift(); entry; entry = queue.shift()) {
    if (selected(entry)) await runOne(entry)
    else unselected++
  }
  // The fixtures of the file. All tests of a file are in the queue
  // before the first one runs, if the file calls `test` with no
  // `await` between the calls.
  // The afterAll hooks of the file run first, if a test ran.
  if (fileCleanups.length || (root.started && root.afterAll.length)) {
    fileState.ran = true
    await endGroup(root, [root])
  }
  // What a child process wrote after the last test ended.
  await cover()
  draining = false
  scheduled = false
  // This timer does not keep the process alive. It fires only if
  // something else does. workerd has no process that stays alive.
  if (!workerd()) idle ??= setTimeout(leaked, IDLE_MS).unref()
}

/** The tests that ran in this process. */
const ran = new Set<string>()

/** The last event of the file. With `ubq --update`, the snapshot file is written first. */
const fileEnd = (): void => {
  let updated = 0
  try {
    updated = saveSnapshots(file!, ran, ids)
  } catch (error) {
    emit({ type: 'file-error', file: file!, failure: errorFailure(error) })
  }
  emit({ type: 'file-end', file: file!, unselected, ...(updated && { updated }) })
}

const IDLE_MS = 1000
let idle: ReturnType<typeof setTimeout> | undefined
let waitedAgain = false

// The tests ended, but the process did not exit.
const leaked = (): void => {
  idle = undefined
  if (finished || draining || queue.length) return
  const pending = stillOpen()
  // On a slow machine, this timer and the last timer of a test can
  // be due in the same turn. Then nothing is open, and the process
  // is about to exit. One more wait tells the two cases apart.
  // ubq: not measured: the second wait is for a slow machine
  if (!pending.length && !waitedAgain) {
    waitedAgain = true
    idle = setTimeout(leaked, IDLE_MS).unref()
    return
  }
  finished = true
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
  fileEnd()
  process.exit()
}

// An error that nothing caught belongs to the test that runs now.
// With no test, it belongs to the file.
const stray = (error: unknown): void => {
  // The error can come from a callback of a test that ended before.
  const owner = current.getStore()
  if (owner?.ended) {
    if (owner.failure || owner.late) return
    owner.late = true
    const failure = errorFailure(error)
    return emit({
      type: 'late-failure',
      id: owner.id,
      failure: { ...failure, kind: 'late', message: `after the test ended: ${failure.message}` },
    })
  }
  if (active) return active.fail(errorFailure(error))
  // The test of the assertion has the failure.
  // ubq: not measured: a failed assertion of a test rejects the promise of the test
  if (error instanceof AssertionFailure && !error.outside) return
  start()
  failedOutside = true
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
  fileEnd()
})

/** True if an error that no test caught failed the file. */
let failedOutside = false

/** The process has no more work, so no more tests can arrive. */
const noMoreWork = (): void => {
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
  // A file that failed before it had a test has its error already:
  // "no tests" says nothing more.
  if (ids.size ? unselected === ids.size : !failedOutside)
    emit({
      type: 'file-error',
      file: file!,
      failure: {
        kind: 'no-tests',
        message: !ids.size
          ? 'the file registered no tests'
          : wanted.length
            ? `no test of this file has an ID in the selection. The IDs in this file are:\n${[...ids].join('\n')}`
            : `no test starts at or before line ${lines.join(', ')} of this file`,
      },
    })
  fileEnd()
}
process.on('beforeExit', noMoreWork)

// workerd has no `beforeExit`. The module that loads the test file
// calls this when the file is loaded.
if (host)
  host.finish = async () => {
    // ubq: not measured: the Workers tests end with an empty queue
    while (scheduled || draining || queue.length) await new Promise(done => setTimeout(done, 1))
    noMoreWork()
  }
