// `ubq convert`: changes the test files of a different test tool to
// the API of ubq. It makes each change that is certain, and writes a
// `TODO(ubq)` comment where a person or an agent must decide.
// `ubq guide convert` (CONVERT.md) tells how to do the rest.
//
// The changes are text edits at positions of the syntax tree. An
// argument of a call keeps its text, so a rule for a call and a
// rule for a call in its arguments do not touch the same text.
import { spawnSync } from 'node:child_process'
import { existsSync, globSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { config, UsageError } from './config.ts'
import { restorePlan } from './convert-restore.ts'
import type { Node } from './instrument.ts'
import { OLD_TOOL } from './doctor.ts'
import { projectRoot, rel } from './project.ts'
import { type Transformer, transformer } from './transform.ts'
import { setupTransform } from './transform-setup.ts'
import { playwrightNotes, setupMigrations, viteDefine, vitestWorkers } from './vitest-config.ts'
import { counted } from './counted.ts'

// The source is `.ts`, and the bundle is `.js`.
const INSTRUMENT = import.meta.url.endsWith('.ts') ? './instrument.ts' : './instrument.js'

export interface Converted {
  /** The new text of the file. */
  code: string
  /** `tap`, `tape`, `ava`, `node:test`, `vitest`, `jest`, `mocha`, `bun:test`, or `playwright`. */
  framework: string
  /** The count of rules that changed text. */
  changes: number
  /** The `TODO(ubq)` comments, with their line in `code`. */
  todos: { line: number; text: string }[]
}

type Parse = (source: string, file: string) => Node
type Children = (node: Node) => Node[]

/** What a name in the file is. */
type Role =
  | 'tap'
  | 'test'
  | 'describe'
  | 'hook'
  | 'expect'
  | 'assert'
  | 'vi'
  | 'mock'
  /** A function of `node:assert` with its own name: `strictEqual`. */
  | `assert.${string}`
  /** A name of `cloudflare:test`, the module of the vitest plugin for Workers. */
  | `cf.${string}`

const FRAMEWORKS: Record<string, string> = {
  tap: 'tap',
  tape: 'tape',
  ava: 'ava',
  'node:test': 'node:test',
  vitest: 'vitest',
  '@jest/globals': 'jest',
  'bun:test': 'bun:test',
  '@playwright/test': 'playwright',
}
/** The packages of the Playwright library, which a test can use with any test tool. */
const PLAYWRIGHT_LIBRARY = new Set(['playwright', 'playwright-core'])

/**
 * `expect(locator).name(expected)` of Playwright, which waits for
 * the value: the method that reads the value. `true` is for a check
 * with no expected value. `$1` is the first argument of the check.
 */
const WEB_FIRST: Record<string, [read: string, expected: true | number]> = {
  toBeVisible: ['isVisible()', true],
  toBeHidden: ['isHidden()', true],
  toBeEnabled: ['isEnabled()', true],
  toBeDisabled: ['isDisabled()', true],
  toBeChecked: ['isChecked()', true],
  toBeEditable: ['isEditable()', true],
  toHaveCount: ['count()', 0],
  toHaveValue: ['inputValue()', 0],
  toHaveText: ['textContent()', 0],
  toContainText: ['textContent()', 0],
  toHaveTitle: ['title()', 0],
  toHaveURL: ['url()', 0],
  toHaveAttribute: ['getAttribute($1)', 1],
}
const ASSERT_MODULES = new Set(['node:assert', 'node:assert/strict', 'assert', 'assert/strict'])
const HOOKS = new Set(['before', 'after', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll'])
const NOT_CONVERTED: Record<string, string> = {
  chai: 'chai',
  mocha: 'mocha',
  sinon: 'sinon',
  jasmine: 'jasmine',
}

// `$0` is argument 0 as it is. `<$0>` gets parentheses if it is not
// a simple expression. The numbers must go up.
type Rule = string | { [argc: number]: string; rest?: string }

/** The functions of `cloudflare:test` that `ubqtest/workers` has, with their names there. */
const WORKERS: Record<string, string> = {
  createExecutionContext: 'executionContext',
  waitOnExecutionContext: 'settled',
  createScheduledController: 'scheduledController',
  applyD1Migrations: 'migrate',
}

/** `expect(a).name(b)`: `$0` is `a`, `$1` is `b`. */
const MATCHERS: Record<string, Rule> = {
  toBe: 'assert.equal($0, $1)',
  toEqual: 'assert.deepEqual($0, $1)',
  toStrictEqual: 'assert.deepEqual($0, $1)',
  toBeTruthy: 'assert($0)',
  toBeFalsy: 'assert(!<$0>)',
  toBeNull: 'assert.equal($0, null)',
  toBeUndefined: 'assert.equal($0, undefined)',
  // Not `assert.notEqual`: it is a type error if the type of the
  // value has no undefined in it.
  toBeDefined: 'assert(<$0> !== undefined)',
  toBeNaN: 'assert(Number.isNaN($0))',
  toContain: 'assert.contains($0, $1)',
  toHaveLength: 'assert.equal(<$0>.length, $1)',
  toMatchObject: 'assert.match($0, $1)',
  toBeInstanceOf: 'assert(<$0> instanceof $1)',
  toBeGreaterThan: 'assert.greaterThan($0, $1)',
  toBeGreaterThanOrEqual: 'assert.greaterThanOrEqual($0, $1)',
  toBeLessThan: 'assert.lessThan($0, $1)',
  toBeLessThanOrEqual: 'assert.lessThanOrEqual($0, $1)',
  toThrow: { 1: 'assert.throws($0, Error)', 2: 'assert.throws($0, $1)' },
  toThrowError: { 1: 'assert.throws($0, Error)', 2: 'assert.throws($0, $1)' },
  toHaveBeenCalled: 'assert(<$0>.calls.length > 0)',
  toHaveBeenCalledTimes: 'assert.equal(<$0>.calls.length, $1)',
  toHaveBeenCalledOnce: 'assert.equal(<$0>.calls.length, 1)',
  toMatchSnapshot: { 1: 'assert.snapshot($0)' },
  // The precision is the same number: a count of digits, 2 if absent.
  toBeCloseTo: { 2: 'assert.close($0, $1)', 3: 'assert.close($0, $1, $2)' },
  // The same as `key in object`. The arguments keep their order.
  // `Object()`: the value can be undefined, and expect() took that.
  toHaveProperty: { 2: 'assert(Reflect.has(Object($0), $1))' },
  toContainEqual: 'assert(<$0>.some(ITEM => isDeepEqual(ITEM, $1)))',
  toBeTypeOf: 'assert.equal(typeof <$0>, $1)',
  // jest-dom. An element that a query did not find is null.
  toBeInTheDocument: { 1: 'assert(<$0>?.isConnected)' },
  toHaveAttribute: { 2: 'assert(<$0>.hasAttribute($1))', 3: 'assert.equal(<$0>.getAttribute($1), $2)' },
  toHaveClass: { 2: 'assert(<$0>.classList.contains($1))' },
  toBeDisabled: { 1: "assert(<$0>.matches(':disabled'))" },
  toBeEnabled: { 1: "assert(!<$0>.matches(':disabled'))" },
  toBeChecked: { 1: "assert(<$0>.matches(':checked'))" },
  toHaveFocus: { 1: 'assert.equal(document.activeElement, $0)' },
}
/** Other names of jest and vitest for a matcher. */
const ALIAS: Record<string, string> = {
  toBeCalled: 'toHaveBeenCalled',
  toBeCalledTimes: 'toHaveBeenCalledTimes',
  toBeCalledWith: 'toHaveBeenCalledWith',
  lastCalledWith: 'toHaveBeenLastCalledWith',
  nthCalledWith: 'toHaveBeenNthCalledWith',
}
/** With `.not`. A matcher that is not here and makes `assert(x)` becomes `assert(!(x))`. */
const NOT_MATCHERS: Record<string, Rule> = {
  toBe: 'assert.notEqual($0, $1)',
  toEqual: 'assert(!isDeepEqual($0, $1))',
  toStrictEqual: 'assert(!isDeepEqual($0, $1))',
  toContain: 'assert.notContains($0, $1)',
  toBeNull: 'assert.notEqual($0, null)',
  toBeUndefined: 'assert.notEqual($0, undefined)',
  toBeDefined: 'assert.equal($0, undefined)',
  toBeTruthy: 'assert(!<$0>)',
  toBeFalsy: 'assert($0)',
  toHaveBeenCalled: 'assert.equal(<$0>.calls.length, 0)',
  toBeTypeOf: 'assert.notEqual(typeof <$0>, $1)',
  // Not `assert(!(a instanceof B))`: for a value of the type B, it
  // narrows the value to `never`.
  toBeInstanceOf: 'assert.equal(<$0> instanceof $1, false)',
  toBeInTheDocument: { 1: 'assert(!<$0>?.isConnected)' },
  toHaveAttribute: { 2: 'assert(!<$0>.hasAttribute($1))', 3: 'assert.notEqual(<$0>.getAttribute($1), $2)' },
  toBeChecked: { 1: "assert(!<$0>.matches(':checked'))" },
  toHaveFocus: { 1: 'assert.notEqual(document.activeElement, $0)' },
  toBeGreaterThan: 'assert(!(<$0> > <$1>))',
  toBeLessThan: 'assert(!(<$0> < <$1>))',
  toBeGreaterThanOrEqual: 'assert(!(<$0> >= <$1>))',
  toBeLessThanOrEqual: 'assert(!(<$0> <= <$1>))',
  // The default of jest and vitest: 2 digits.
  toBeCloseTo: { 2: 'assert(!(Math.abs(<$0> - <$1>) < 0.005))', 3: '$9' },
}

/** The end of a callee that calls its function argument before it returns. */
const SYNC = /(^|\.)(forEach|map|filter|some|every|reduce|sort|find|throws|doesNotThrow|notThrows)$/

/** `t.name(a, b)` of tap: `$0` is `a`. A message after the last argument goes into a comment. */
const TAP: Record<string, Rule> = {}
const tap = (names: string, rule: Rule): void => {
  for (const name of names.split(' ')) TAP[name] = rule
}
tap('equal equals is strictEqual strictEquals isEqual isStrict', 'assert.equal($0, $1)')
tap(
  'not notEqual notEquals inequal isInequal notStrictEqual notStrictEquals isNot isNotEqual doesNotEqual notLooseEqual notLooseEquals',
  'assert.notEqual($0, $1)',
)
tap(
  'same strictSame deepEqual deepEquals strictDeepEqual looseEqual looseEquals deepLooseEqual equivalent isEquivalent',
  'assert.deepEqual($0, $1)',
)
tap(
  'notSame notStrictSame notDeepEqual notDeepEquals notDeeply notEquivalent isNotDeepEqual isNotDeeply isNotEquivalent isInequivalent notDeepLooseEqual',
  'assert(!isDeepEqual($0, $1))',
)
tap('ok true assert', 'assert($0)')
tap('notOk notok false assertNot', 'assert(!<$0>)')
tap('match has hasStrict matchStrict matchOnly', 'assert.match($0, $1)')
tap('throws throw', { 1: 'assert.throws($0, Error)', 2: 'assert.throws($0, $1)' })
tap('rejects', { 1: 'assert.rejects($0, Error)', 2: 'assert.rejects($0, $1)' })
tap('resolveMatch resolveMatchSnapshot', 'assert.match(await $0, $1)')
tap('pass', { 0: 'assert(true)', 1: 'assert(true)' })
tap('fail', { 0: "assert.fail('fail')", 1: 'assert.fail($0)' })
tap('error ifError ifErr iferror', 'assert(!<$0>)')
tap('matchSnapshot', 'assert.snapshot($0)')
tap('teardown after', 'cleanup($0)')
tap('testdir', { 0: 'testdir()', 1: 'testdir($0)' })

/** `t.name(a, b)` of tape: the names of tap, and `match` for a string only. */
const TAPE: Record<string, Rule> = { ...TAP, doesNotMatch: 'assert.equal(<$0>.match($1), null)' }

/** `t.name(a, b)` of ava. `t.true` is not `t.truthy`. */
const AVA: Record<string, Rule> = {
  is: 'assert.equal($0, $1)',
  not: 'assert.notEqual($0, $1)',
  deepEqual: 'assert.deepEqual($0, $1)',
  notDeepEqual: 'assert(!isDeepEqual($0, $1))',
  like: 'assert.match($0, $1)',
  assert: 'assert($0)',
  truthy: 'assert($0)',
  falsy: 'assert(!<$0>)',
  true: 'assert.equal($0, true)',
  false: 'assert.equal($0, false)',
  regex: 'assert.match($0, $1)',
  notRegex: 'assert.equal(<$0>.match($1), null)',
  pass: { 0: 'assert(true)', 1: 'assert(true)' },
  fail: { 0: "assert.fail('fail')", 1: 'assert.fail($0)' },
  snapshot: { 1: 'assert.snapshot($0)' },
  teardown: 'cleanup($0)',
}

/** Methods of `node:assert`. A string is the new name. A rule is the new call. */
const ASSERT: Record<string, Rule> = {
  strictEqual: 'assert.equal($0, $1)',
  equal: 'assert.equal($0, $1)',
  notStrictEqual: 'assert.notEqual($0, $1)',
  notEqual: 'assert.notEqual($0, $1)',
  deepStrictEqual: 'assert.deepEqual($0, $1)',
  deepEqual: 'assert.deepEqual($0, $1)',
  notDeepStrictEqual: 'assert(!isDeepEqual($0, $1))',
  notDeepEqual: 'assert(!isDeepEqual($0, $1))',
  ok: 'assert($0)',
  match: 'assert.match($0, $1)',
  throws: { 1: 'assert.throws($0, Error)', 2: 'assert.throws($0, $1)' },
  rejects: { 1: 'assert.rejects($0, Error)', 2: 'assert.rejects($0, $1)' },
  fail: { 0: "assert.fail('fail')", 1: 'assert.fail($0)' },
  ifError: 'assert(!<$0>)',
}

const TODO = {
  hook: 'ubq has no hooks. Make a setup function and call it in each test. Use cleanup() for the work after a test.',
  hookFile:
    'ubq has no hooks. Put this code at the top level of the file, with await. It runs at this place, not later: put it after the declarations that it uses.',
  hookFileEnd: 'ubq has no hooks. At the top level of the file, cleanup(fn) runs fn when the file ends.',
  hookGroup:
    'ubq has no hooks. If the work is not async, put it in the function of the describe, as a const: it runs one time, when the file loads. If it is async, make a function that does it one time, and await it at the start of each test of the group: let ready; const setup = () => (ready ??= work()).',
  matcher:
    "ubq has no expect. In assert.match, a partial object does the work of objectContaining, and a RegExp does the work of stringContaining and stringMatching. An object pattern is partial at each depth, and an array pattern must have the same length. A function does the work of any and anything: { id: (v: unknown) => typeof v === 'number' }, v instanceof URL, v != null. assert.deepEqual compares a function as a value: change it to assert.match, which permits keys that the pattern does not have. For arrayContaining, assert on each element: assert.contains(list, x), or assert(list.some(item => isDeepEqual(item, x))) for an object. For a call of a spy with arguments of a shape: assert(s.calls.some(call => isMatch(call.args, [pattern]))).",
  assertions:
    'Delete this call. A test with no assertion fails in ubq. If an assertion is in a callback, make the test wait for the callback: await a promise, then assert on the values that the callback got.',
  throwsText:
    'vitest and jest accept a string or an Error here. assert.throws needs an Error class, a RegExp, or a partial object. If this value is a string, make a RegExp from it. If it is an Error, use { message: error.message }.',
  workers:
    "ubq has no 'cloudflare:test'. 'ubqtest/workers' has executionContext, scheduledController, and migrate. For SELF.fetch(request), use exports.default.fetch(request), with exports from 'cloudflare:workers'. Write the test without the other names.",
  restore:
    'A spyOn spy goes back when its test ends. Remove this call, if the code after it does not need the real method: a second spyOn on a key replaces the first. ubq has no call that puts the method back before the test ends.',
  restored:
    'The convert command removed a call here that put spies back. A spyOn spy goes back when its test ends, not before, and a second spyOn on a key replaces the first. If the code after this place needs the real method, move that code to a new test.',
  end: 'ubq has no t.end. A test ends when its function ends. This call is in a callback: make the test function return a promise that the callback resolves.',
  plan: 'ubq has no t.plan. A test ends when its function ends. If an assertion of this test runs in a callback, make the test function return a promise, and resolve it after the last assertion: test(name, () => new Promise(end => { ... end() })). If not, delete this line.',
  notThrows:
    'ubq has no assertion for code that does not throw. Call the function, with await for a promise: a test fails if its code throws.',
  avaThrows:
    "The second argument is an Error class, a RegExp for the message, or a partial object: assert.throws(fn, { message: 'text', code: 'E' }). assert.throws and assert.rejects return the error: assert(error instanceof X).",
  avaContext:
    'ubq has no t.context. Make the values in a setup function, and call it in each test: const { value } = setup().',
  macro: 'ubq has no macros. Give test() a function that calls the macro function, with assert of ubqtest in it.',
  testTimeout: 'Use the option of test(): test(name, { timeout: ms }, fn).',
  mockType:
    "ubq has no types of jest or vitest. A spy has the type Spy<F> of 'ubqtest': import { type Spy } from 'ubqtest'. For an object of spies, give each key its type: { load: Spy<Service['load']> }. A function that returns the object gives the types with no annotation: const make = () => ({ load: spy(async () => user) }).",
  envFirst:
    'The imports of an ES module run before this line, also the imports below it. If a module reads this value while it loads, load that module after this line: const { name } = await import(path). If no module reads it while it loads, this line is correct.',
  separator:
    'The name of a test or of a group must not have " > " in it: ubq puts it between the names of the groups in the ID of a test. Use a different mark, such as " - ".',
  eventually:
    "ubq has no expect. Read the value from the page, and wait for it: await assert.eventually(() => locator.getAttribute('class'), /active/). A check with a time limit of its own, or with not, has no certain form.",
  fixture:
    "ubq has no fixtures. The page is: const page = await browser(), from 'ubqtest/browser'. The context is page.context(). For request, use fetch. For a fixture of the project, call a function in the test.",
  pageHook:
    "ubq has no hooks. Make a function that opens the page, and call it in each test: const open = async () => { const page = await browser(); await page.goto('/'); return page }. Use cleanup() for the work after a test.",
  step: 'ubq has no steps. Put the code of the step in the test, with the name of the step in a comment.',
  use: 'ubq has no test.use. browser(options) takes the options of a context, such as viewport and locale: const page = await browser({ locale: \'fr-FR\' }). The address of the pages is "browser": { "url": ... } in the ubq configuration.',
  skipIn:
    "This call skips the test while it runs. Use the option of test(): test(name, { skip: condition && 'the reason' }, fn).",
  launch:
    "ubq starts the browser, and closes the page when the test ends: const page = await browser(), from 'ubqtest/browser'. Remove the launch, the new page, and the close.",
  subtests:
    'ubq has no test in a test. This is a describe() now. Move the assertions and the setup that are not in a subtest into a test() or a setup function.',
  planSkip:
    't.plan(0, reason) of tap skips the file. In ubq, give each test or describe of the file the option: { skip: condition && "the reason" }. Then remove this line, and the process.exit() after it: a test file must not end the process.',
  assertOption:
    'tap does not count this assertion as a failure: it has the option skip or todo. ubq has no such option for one assertion, so this assertion can fail now. For skip, use the skip option of the test, or skip(reason) of the test function. For todo, correct the code, or skip the test with the reason.',
  tapSetting:
    'ubq has no settings on a test object. The tests of a file run one at a time: for tests that must run at the same time (t.jobs), make them one test that awaits Promise.all. Remove this line.',
  tapType:
    'This type of tap is for a test object, and ubq has none. Remove the parameter of this type from each function, and its argument from each call. Then remove this import.',
  describeBody:
    'This code was in a test of tap, and ran after the tests before it. In describe(), it runs when the file loads, before each test of the file. If it changes the process or a value from outside (process.chdir, a property of process, a variable), move it into a setup function that each test of the group calls.',
  rootAssert:
    'This assertion is in no test. It runs when the file loads, and a failure is an error of the file, not of a test. If it is a check of the code under test, put it in a test().',
  message:
    'This call is not an assertion now, so it has no place for the message, and the message was not text. If it named the case, put the case in the name of a test: call test() in the loop, one test for each case.',
  failLoop:
    'assert.fail ends the test at the first wrong value. To see all of them, collect the wrong values in a list in the loop, and assert.deepEqual(wrong, []) after the loop.',
  passed:
    'ubq has no test object to pass to a function. Remove this argument, and the parameter of the function. The function imports assert from ubqtest.',
  skip: "Give the reason: { skip: 'the reason' }.",
  context: 'ubq has no test object. Use the functions of ubqtest in place of the parameter of this test function.',
  done: 'ubq has no done callback. Make the test function async, and await a promise.',
  mock: "Use mockImport in each test that needs the mock: const { f } = await mockImport(() => import('<the module under test>'), [[() => import('<the dependency>'), { ...(await import('<the dependency>')), fn: spy(impl) }]]). The paths are from this test file. The mock replaces the dependency in each project module of the new instance. Each call gives a new instance.",
  spyImpl:
    'A spy gets its implementation as an argument: spy(impl), spyOn(object, key, impl). For a result that changes, the implementation reads a variable: let result = 1; const s = spy(() => result). For a different result in each call: spy.results(a, b), or for an async function spy.results(Promise.resolve(a), Promise.reject(error)). A call after the last result throws. A call is spy.calls[i]: { args, result, error }.',
  spyClear:
    'To forget the calls of a spy: s.calls.length = 0. A spy that a test makes has no calls from other tests: then delete this call.',
  timers: 'Use fakeClock: const clock = fakeClock(), then await clock.tick(ms). The clock ends when its test ends.',
  each: 'Use a for loop around test(). Each name must be different: put the value or the index in the name. Use JSON.stringify for an object: %s of an object is [object Object].',
  eachGroup:
    'Use a for loop around describe(). Each name must be different: put the value or the index in the name. Use JSON.stringify for an object.',
  notThrow:
    'Call the function, then assert on its result. For a function with no result, assert on what it changed, or on the calls of a spy.',
  inline:
    'ubq has no inline snapshot. For a string, compare it with the text: assert.equal(value, `text`). For another value: assert.snapshot(value), then ubq --update <file>, and check that the new snapshot has the old text.',
  path: "toHaveProperty('a.b') passes for one key with the name 'a.b', and for the key b of the object at the key a. Look at the value to see which one it has. For one key with a dot in its name: assert('a.b' in x). For a path of keys: assert('b' in x.a). Use assert(!(...)) for not.",
  only: 'ubq has no .only. Run one test with: ubq <file>:<line>.',
  resolves: 'A test needs an assertion. Await the promise and assert on its value.',
  rejects:
    'assert.rejects gives the value that the promise rejects with: const error = await assert.rejects(promise, Error). Then assert on it: assert.equal(error, expected). The second argument is an error class, a RegExp for the message, or a partial object.',
  require:
    "An ES module has no require. Use an import statement, await import('name'), or createRequire(import.meta.url) of node:module.",
  enum: 'Node runs TypeScript with the types removed, and it cannot run an enum. Make it an object: const Name = { A: 0, B: 1 } as const.',
  parameterProperty:
    'Node runs TypeScript with the types removed, and it cannot run a parameter property. Declare the field in the class, and assign it in the constructor.',
  spyThis:
    'A spy of ubq records { args, result, error } for each call, and not the value of this. Give the spy an implementation that keeps it: const seen: unknown[] = []; const s = spy(function (this: unknown) { seen.push(this) }). Then assert on seen.',
  testValue:
    "ubq has no test.skip and no test.only. For a function that skips a test: (name: string, fn: () => void) => test(name, { skip: 'the reason' }, fn).",
  dom: 'This file needs a DOM. ubq has no test environment. For a library that reads the document when it loads, such as Testing Library, make the DOM in a helper file that then loads the library, and import render and screen from that file: see "Testing Library" in `ubq guide convert`. For other tests, make the DOM in each test that needs it, with a function that stubs the globals: see "A DOM".',
} as const

/** The compiler of the `transform` key. Undefined if the project has no such key. Null before the first use. */
let compiler: Transformer | undefined | null = null
/** True if the compiler of the project makes CommonJS from the file. */
const commonjs = (file: string): boolean => {
  if (compiler === null)
    try {
      const key = config().transform
      compiler = key ? transformer(projectRoot(), key) : undefined
    } catch {
      // `ubq doctor` reports a configuration that is not correct.
      compiler = undefined
    }
  return compiler?.format(resolve(file)) === 'commonjs'
}

const TICK =
  'Use await clock.tick(ms), with the clock of fakeClock(). A timer of 0 ms runs after 1 ms, as in Node: for a time of 0, use clock.tick(1).'

/** The TODO text for a function of `vi` or `jest`. */
const VI: Record<string, string> = {
  clearAllMocks: TODO.spyClear,
  resetAllMocks: TODO.spyClear,
  useFakeTimers:
    'Use fakeClock: const clock = fakeClock(). It replaces the timers and Date until the test ends. Make it in the test that uses it: if this is in a hook, make the clock in a setup function that each test calls.',
  setSystemTime:
    'Use clock.set(time), with the clock of fakeClock(). It sets the time of Date and runs no timer. Or give the time when you make the clock: fakeClock({ now: time }).',
  advanceTimersByTime: TICK,
  advanceTimersByTimeAsync: TICK,
  runAllTimers: 'Use await clock.runAll(), with the clock of fakeClock().',
  runAllTimersAsync: 'Use await clock.runAll(), with the clock of fakeClock().',
  runOnlyPendingTimers: 'Use await clock.runAll(), with the clock of fakeClock().',
  runOnlyPendingTimersAsync: 'Use await clock.runAll(), with the clock of fakeClock().',
  useRealTimers:
    'Delete this call. The clock of fakeClock() ends when its test ends. To end it before that: clock.restore().',
  stubGlobal: "Use stub(globalThis, 'name', value). It puts the old value back when the test ends.",
  stubEnv: "Use env({ NAME: 'value' }). It puts the variable back when the test ends.",
  unstubAllGlobals: 'Delete this call. stub() puts back each value when the test ends.',
  unstubAllEnvs: 'Delete this call. env() puts back each variable when the test ends.',
  waitFor:
    'Use await assert.eventually(() => value, pattern). It calls the function until its value matches the pattern, for 2000 ms at most.',
  waitUntil:
    'Use await assert.eventually(() => value, pattern). It calls the function until its value matches the pattern, for 2000 ms at most.',
  mocked:
    'vi.mocked(x) only changes the type of x. If x is a spy, use x. If x is an import that vi.mock replaced, make a spy, and give it to mockImport in place of the export.',
  hoisted:
    'ubq has no hoisting. Make these values at the top level of the file, before the code that uses them, or in the test.',
  resetModules:
    "Use mockImport(() => import('<the module>'), []) in the test. It gives a new instance of the module, and of the project modules that it imports.",
  importActual:
    "Use await import('<the module>'). In a mock of mockImport, spread it: { ...(await import('<the module>')), fn }.",
}

/** The width of a line of a TODO comment, unless the indent is deep. */
const WIDTH = 75

/** The end of a TODO whose full text is in an earlier TODO of the file. */
const AS_ABOVE = 'The full text is at the first TODO of this file with this sentence.'

/** A `TODO(ubq)` comment, in lines of WIDTH characters at most. */
export const todoComment = (indent: string, message: string): string => {
  const width = Math.max(WIDTH, indent.length + 40)
  const lines: string[] = []
  let line = `${indent}// TODO(ubq):`
  for (const word of message.split(' ')) {
    if (line.length + 1 + word.length > width && line.length > indent.length + 3) {
      lines.push(line)
      line = `${indent}//`
    }
    line += ` ${word}`
  }
  return [...lines, line].join('\n') + '\n'
}

const SIMPLE = new Set([
  'Identifier',
  'MemberExpression',
  'CallExpression',
  'NewExpression',
  'Literal',
  'TemplateLiteral',
  'ThisExpression',
  'ArrayExpression',
  // `a?.b`: parentheses end the chain, and `(a?.b).length` throws.
  'ChainExpression',
])

const FUNCTION = new Set(['ArrowFunctionExpression', 'FunctionExpression'])
const LOOP = /^(For|ForIn|ForOf|While|DoWhile)Statement$/

/**
 * Converts the text of one test file. Returns undefined if the file
 * uses no test tool that this command knows. Throws if the parser
 * cannot read the file.
 */
export const convertSource = (
  source: string,
  file: string,
  parse: Parse,
  children: Children,
  /** D1 bindings: the file gets `await migrate(binding)` after its imports. */
  migrate: string[] = [],
  /** The starts of the statements and properties to remove: see restorePlan. */
  drop: Set<number> = new Set(),
): Converted | undefined => {
  const program = parse(source, file)
  const text = (n: Node): string => source.slice(n.start, n.end)
  const edits: { start: number; end: number; text: string }[] = []
  const replace = (start: number, end: number, to: string): void => {
    if (source.slice(start, end) !== to) edits.push({ start, end, text: to })
  }
  /** Names to import from ubqtest. */
  const used = new Set<string>()
  const roles = new Map<string, Role>()
  /** The start of a statement, and the TODO texts for it. */
  const todos = new Map<number, Set<string>>()
  let changes = 0
  let framework: string | undefined
  let commonJs = false
  /** Statements of the old test tool to remove: imports and `require` calls. */
  const removed: Node[] = []

  // --- The names of the old test tool ---
  /** Names of the `test` function of tap. Its test function gets the test object. */
  const tapTests = new Set<string>()
  /** Each `t.end()` of a test that ends in a callback, and the name of the function that it becomes. */
  const endCalls = new Map<Node, string>()
  /** The functions of those tests. */
  const promised = new Set<Node>()
  const bind = (module: string, imported: string, local: string): void => {
    if (ASSERT_MODULES.has(module)) {
      roles.set(
        local,
        imported === 'default' || imported === '*' || imported === 'strict' ? 'assert' : `assert.${imported}`,
      )
      return
    }
    if (module === 'tap') {
      if (imported === 'test') tapTests.add(local)
      roles.set(
        local,
        imported === 'test' ? 'test' : imported === 'default' || imported === '*' || imported === 't' ? 'tap' : 'hook',
      )
      // The test object has the name `t` in almost all tap tests,
      // also in a helper function that gets it as an argument.
      roles.set('t', 'tap')
      return
    }
    if (module === 'ava' || module === 'tape') {
      // The other names of ava are types.
      if (imported === 'default' || imported === '*' || imported === 'test') {
        tapTests.add(local)
        roles.set(local, 'test')
      }
      roles.set('t', 'tap')
      return
    }
    // node:test, vitest, @jest/globals, bun:test
    if (imported === 'default' || imported === 'test' || imported === 'it') roles.set(local, 'test')
    else if (imported === 'describe' || imported === 'suite') roles.set(local, 'describe')
    else if (HOOKS.has(imported)) roles.set(local, 'hook')
    else if (imported === 'expect') roles.set(local, 'expect')
    else if (imported === 'vi' || imported === 'jest') roles.set(local, 'vi')
    else if (imported === 'mock') roles.set(local, 'mock')
    else if (/^(vitest|@jest\/globals|bun:test)$/.test(module) && imported.startsWith('Mock')) toolTypes.add(local)
    if (roles.has(local)) importedRoles.add(local)
  }
  /** Types of the old test tool that the file imports: `Mock`, `MockInstance`. */
  const toolTypes = new Set<string>()
  /** The names with a role that the file imports. Not a global of jest. */
  const importedRoles = new Set<string>()
  /** Names of `@playwright/test` that the file keeps, from `playwright-core`. */
  const libraryTypes: string[] = []
  const libraryValues: string[] = []
  /** True if a test of the file gets its page from `browser()`. */
  let usesBrowser = false
  /** The names of the browsers of the Playwright library in the file: `chromium`. */
  const launchers = new Set<string>()
  /** The imports of `cloudflare:test`, and what becomes of their names. */
  const workersImports: Node[] = []
  /** `env`: the runtime has it in `cloudflare:workers`. */
  const workersKept: string[] = []
  /** Names that `ubqtest/workers` has no function for. */
  const workersLeft: string[] = []
  /** Names to import from `ubqtest/workers`. */
  const workersUsed = new Set<string>()
  /**
   * `SELF.fetch(request)` of `cloudflare:test` is
   * `exports.default.fetch(request)` of `cloudflare:workers`
   * (D115). Changes each `SELF.` in the file, and returns their
   * count. Undefined, with no change, if the file uses the name in
   * a different way, or has the name `exports`.
   */
  const selfCalls = (local: string): number | undefined => {
    if (/\bexports\b/.test(source)) return undefined
    const members: Node[] = []
    let others = 0
    const visit = (node: Node, parent?: Node): void => {
      if (node.type === 'ImportDeclaration') return
      if (node.type === 'Identifier' && node.name === local) {
        if (parent?.type === 'MemberExpression' && parent.object === node && !parent.computed) members.push(node)
        else others++
      }
      for (const child of children(node)) visit(child, node)
    }
    visit(program)
    if (others) return undefined
    for (const node of members) replace(node.start, node.end, 'exports.default')
    changes += members.length
    return members.length
  }
  const known = (module: string): boolean => module in FRAMEWORKS || ASSERT_MODULES.has(module)
  /** `import * as name` of a module that is not a test tool: the name, then the module. */
  const namespaces = new Map<string, string>()
  /** The other imported names of such modules. */
  const imported = new Map<string, string>()
  /** The modules that the file replaces with `vi.mock` or `jest.mock`. */
  const mocked = new Set([...source.matchAll(/\b(?:vi|jest)\.(?:mock|doMock)\(\s*(['"])([^'"\n]+)\1/g)].map(m => m[2]!))
  let other: string | undefined
  for (const node of program.body as Node[]) {
    if (node.type === 'ImportDeclaration') {
      const module = (node.source as { value: string }).value
      if (module === 'cloudflare:test') {
        const specifiers = node.specifiers as Node[]
        // `import * as cf from 'cloudflare:test'`: the names are not
        // known here. The import stays, with a TODO.
        if (specifiers.some(s => s.type !== 'ImportSpecifier')) {
          todos.set(node.start, new Set([TODO.workers]))
          continue
        }
        workersImports.push(node)
        let uses: number | undefined
        for (const s of specifiers) {
          const name = (s.imported as { name: string }).name
          const local = (s.local as { name: string }).name
          if (name === 'env') workersKept.push(name === local ? name : `${name} as ${local}`)
          else if (name === 'SELF' && (uses = selfCalls(local)) !== undefined) {
            if (uses) workersKept.push('exports')
          } else if (name in WORKERS) roles.set(local, `cf.${name}`)
          else workersLeft.push(text(s))
        }
        continue
      }
      if (module in NOT_CONVERTED) other = NOT_CONVERTED[module]
      if (PLAYWRIGHT_LIBRARY.has(module))
        for (const s of node.specifiers as Node[])
          if (/^(chromium|firefox|webkit)$/.test(String((s.imported as { name?: string } | undefined)?.name)))
            launchers.add((s.local as { name: string }).name)
      if (!known(module)) {
        for (const s of node.specifiers as Node[])
          (s.type === 'ImportNamespaceSpecifier' ? namespaces : imported).set(
            (s.local as { name: string }).name,
            module,
          )
        continue
      }
      if (FRAMEWORKS[module]) framework = FRAMEWORKS[module]
      // `import type { Test } from 'tap'`, for the parameter of a
      // helper: the import stays, with a TODO, while a name of it
      // is in the file.
      if (
        node.importKind === 'type' &&
        (node.specifiers as Node[]).some(
          one => source.split(new RegExp(`\\b${(one.local as { name: string }).name}\\b`)).length > 2,
        )
      ) {
        todos.set(node.start, new Set([/^(tap|ava|tape)$/.test(module) ? TODO.tapType : TODO.mockType]))
        continue
      }
      removed.push(node)
      if (module === '@playwright/test')
        // The other names are in the library: `Page`, `devices`.
        for (const s of node.specifiers as Node[]) {
          const name = (s.imported as { name?: string } | undefined)?.name
          if (name && name !== 'test' && name !== 'expect')
            (node.importKind === 'type' || s.importKind === 'type' ? libraryTypes : libraryValues).push(
              text(s).replace(/^type\s+/, ''),
            )
        }
      for (const s of node.specifiers as Node[]) {
        const local = (s.local as { name: string }).name
        const imported =
          s.type === 'ImportDefaultSpecifier'
            ? 'default'
            : s.type === 'ImportNamespaceSpecifier'
              ? '*'
              : ((s.imported as { name?: string; value?: string }).name ?? (s.imported as { value: string }).value)
        bind(module, imported, local)
      }
    } else if (node.type === 'VariableDeclaration') {
      // const t = require('tap'), const { test } = require('node:test')
      const decls = node.declarations as Node[]
      const init = decls[0]?.init as Node | undefined
      // ava: const test = anyTest as TestFn<Context>
      const cast = init?.type === 'TSAsExpression' ? (init.expression as { name?: string }).name : undefined
      const alias = (decls[0]?.id as { name?: string } | undefined)?.name
      if (decls.length === 1 && cast && alias && tapTests.has(cast)) {
        tapTests.add(alias)
        roles.set(alias, 'test')
        removed.push(node)
        continue
      }
      const callee = init?.callee as { name?: string } | undefined
      const arg = (init?.arguments as Node[] | undefined)?.[0] as { value?: unknown } | undefined
      if (decls.length !== 1 || init?.type !== 'CallExpression' || callee?.name !== 'require') continue
      const module = String(arg?.value)
      if (module in NOT_CONVERTED) other = NOT_CONVERTED[module]
      if (!known(module)) continue
      if (FRAMEWORKS[module]) framework = FRAMEWORKS[module]
      commonJs = true
      removed.push(node)
      const id = decls[0]!.id as Node
      if (id.type === 'Identifier') bind(module, 'default', (id as unknown as { name: string }).name)
      else if (id.type === 'ObjectPattern')
        for (const prop of id.properties as Node[]) {
          const key = (prop.key as { name?: string } | undefined)?.name
          const value = (prop.value as { name?: string } | undefined)?.name
          if (key && value) bind(module, key, value)
        }
    }
  }
  if (!framework) {
    // jest and mocha give their functions as globals. mocha has no
    // assertions of its own: a file can use node:assert with it.
    const expects = /\bexpect\s*\(/.test(source)
    if (other || !/\b(describe|it|test)\s*\(/.test(source) || (!expects && !removed.length)) return undefined
    framework = expects ? 'jest' : 'mocha'
    for (const name of ['test', 'it']) roles.set(name, 'test')
    roles.set('describe', 'describe')
    roles.set('expect', 'expect')
    roles.set('jest', 'vi')
    for (const hook of HOOKS) roles.set(hook, 'hook')
  }

  // --- Helpers ---
  const lineStart = (at: number): number => source.lastIndexOf('\n', at - 1) + 1
  const indentAt = (at: number): string => /^[ \t]*/.exec(source.slice(lineStart(at), at))![0]
  /**
   * Text that moved to a different column: each line that starts
   * from `start` to `end` moves by `by` spaces.
   */
  const shifts: { start: number; end: number; by: number }[] = []
  /** The statement that has a node in it, from the path to the node. */
  const statementOf = (path: Node[]): Node => {
    for (let i = path.length - 1; i > 0; i--) {
      const parent = path[i - 1]!
      if (parent.type === 'Program' || parent.type === 'BlockStatement' || parent.type === 'SwitchCase') return path[i]!
    }
    // ubq: not measured: a statement is always inside the Program
    return path.at(-1)!
  }
  const todo = (path: Node[], message: string): void => {
    const at = statementOf(path).start
    todos.set(at, (todos.get(at) ?? new Set()).add(message))
  }
  const roleOf = (node: Node | undefined): Role | undefined =>
    node?.type === 'Identifier' ? roles.get((node as unknown as { name: string }).name) : undefined
  const nameOf = (node: Node | undefined): string | undefined =>
    node?.type === 'Identifier' ? (node as unknown as { name: string }).name : undefined
  /** A name, or a path of names such as `a.b.c`. */
  const plainPath = (node: Node): boolean =>
    node.type === 'Identifier' ||
    node.type === 'ThisExpression' ||
    (node.type === 'MemberExpression' && !node.computed && plainPath(node.object as Node))

  /**
   * Changes a call to the text of a rule. The arguments that the
   * rule names keep their text. Returns those arguments: the walk
   * goes on in them.
   */
  const rewrite = (node: Node, rule: string, args: Node[]): Node[] => {
    // A name for the parameter of a callback that the arguments do not use.
    if (rule.includes('ITEM'))
      rule = rule.replaceAll(
        'ITEM',
        ['item', 'element', 'entry', 'one'].find(name => !args.some(arg => mentions(arg, name))) ?? '_item',
      )
    const pieces: string[] = ['']
    const parts: Node[] = []
    let last = 0
    for (const m of rule.matchAll(/<\$(\d)>|\$(\d)/g)) {
      const part = args[+(m[1] ?? m[2])!]!
      const wrap = m[1] !== undefined && !SIMPLE.has(part.type)
      pieces[pieces.length - 1] += rule.slice(last, m.index) + (wrap ? '(' : '')
      pieces.push(wrap ? ')' : '')
      parts.push(part)
      last = m.index + m[0].length
    }
    pieces[pieces.length - 1] += rule.slice(last)
    changes++
    // ubq: not measured: each rule names a function of ubqtest
    for (const name of rule.match(/\b(assert|cleanup|testdir|spy|spyOn|mockImport|isDeepEqual|isMatch)\b/g) ?? [])
      used.add(name)
    if (!parts.length) {
      replace(node.start, node.end, pieces[0]!)
      return []
    }
    // `expect(\n  a,\n).toBe(b)` and `expect(a).toBe(\n  b,\n)` put
    // each argument on its own line.
    const indent = parts
      .map((part, i) => /\n([ \t]*)$/.exec(source.slice(i ? parts[i - 1]!.end : node.start, part.start))?.[1])
      .find(found => found !== undefined)
    if (
      indent !== undefined &&
      pieces[0]!.endsWith('(') &&
      pieces.at(-1) === ')' &&
      pieces.slice(1, -1).every(piece => piece === ', ')
    ) {
      pieces[0] += `\n${indent}`
      for (let i = 0; i < parts.length; i++) {
        if (i) pieces[i] = `,\n${indent}`
        const by = indent.length - indentAt(parts[i]!.start).length
        if (by) shifts.push({ start: parts[i]!.start, end: parts[i]!.end, by })
      }
      pieces[parts.length] = `,\n${indentAt(node.start)})`
    }
    replace(node.start, parts[0]!.start, pieces[0]!)
    for (let i = 1; i < parts.length; i++) replace(parts[i - 1]!.end, parts[i]!.start, pieces[i]!)
    replace(parts.at(-1)!.end, node.end, pieces.at(-1)!)
    return parts
  }
  const pick = (rule: Rule, argc: number): string | undefined =>
    typeof rule === 'string'
      ? argc >= (rule.match(/\$\d/g)?.length ?? 0) // ubq: not measured: each rule of string form has a $ place
        ? rule
        : undefined
      : (rule[argc] ??
        rule[
          Math.max(
            ...Object.keys(rule)
              .map(Number)
              .filter(n => n <= argc),
          )
        ])

  /** Makes the function of a node async. */
  const madeAsync = new Set<Node>()
  const asyncFunction = (path: Node[]): void => {
    for (let i = path.length - 2; i >= 0; i--) {
      const fn = path[i]!
      if (!FUNCTION.has(fn.type) && fn.type !== 'FunctionDeclaration') continue
      if (!fn.async && !madeAsync.has(fn)) edits.push({ start: fn.start, end: fn.start, text: 'async ' })
      madeAsync.add(fn)
      return
    }
  }
  /** Puts `await` before a call that returns a promise, and makes the function async. */
  const awaited = (node: Node, path: Node[]): void => {
    const parent = path.at(-2)
    if (parent?.type === 'AwaitExpression' || parent?.type === 'ReturnStatement') return
    if (parent?.type === 'ArrowFunctionExpression' && parent.body === node) return
    edits.push({ start: node.start, end: node.start, text: 'await ' })
    asyncFunction(path)
  }
  /** jest: toThrow('text') is true if the message has the text in it. ubq has a RegExp for that. */
  const messageRegExp = (arg: Node | undefined): void => {
    if (arg?.type !== 'Literal' || typeof arg.value !== 'string') return
    replace(arg.start, arg.end, `/${arg.value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&').replace(/\n/g, '\\n')}/`)
  }

  /**
   * The expected error of `toThrow`. A string becomes a RegExp. An
   * Error instance becomes a pattern for its message: jest and
   * vitest compare only the message of an instance.
   */
  const expectedError = (arg: Node | undefined, path: Node[]): void => {
    messageRegExp(arg)
    if (arg?.type === 'NewExpression') {
      const [message, more] = arg.arguments as Node[]
      const plain =
        message && !more && (message.type === 'TemplateLiteral' || typeof message.value === 'string')
          ? text(message)
          : `${text(arg)}.message`
      replace(arg.start, arg.end, `{ message: ${plain} }`)
    } else if (arg?.type === 'Identifier' && /^[A-Z][A-Z0-9]*_[A-Z0-9_]*$/.test(nameOf(arg)!)) {
      // A name such as NOT_FOUND is a constant. If the file gives it
      // text, the check is for a message that has that text.
      const value = new RegExp(`\\bconst\\s+${nameOf(arg)}\\s*=\\s*(['"])((?:(?!\\1)[^\\\\\\n])*)\\1`).exec(source)?.[2]
      if (value === undefined) todo(path, TODO.throwsText)
      else replace(arg.start, arg.end, `/${value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}/`)
    } else if (arg?.type === 'Identifier' && /^[a-z]/.test(nameOf(arg)!)) {
      // A name with a small first letter is a value, not a class.
      if (new RegExp(`\\b(const|let|var)\\s+${nameOf(arg)}\\s*=\\s*new\\s`).test(source))
        replace(arg.start, arg.end, `{ message: ${nameOf(arg)}.message }`)
      else todo(path, TODO.throwsText)
    }
  }

  /** The message of an assertion, as a comment at the end of the line. */
  const messageComment = (node: Node, message: Node | undefined, path: Node[]): void => {
    if (!message || message.type === 'ObjectExpression') return
    const text =
      message.type === 'TemplateLiteral' && !(message.expressions as Node[]).length
        ? (message.quasis as unknown as { value: { cooked: string } }[])[0]!.value.cooked
        : message.value
    // An expression made the message, often from the values of a loop.
    if (typeof text !== 'string') return todo(path, TODO.message)
    if (path.at(-2)?.type !== 'ExpressionStatement') return
    const end = source.indexOf('\n', node.end)
    const rest = source.slice(node.end, end < 0 ? source.length : end)
    if (/^\s*;?\s*$/.test(rest) && !text.includes('\n'))
      edits.push({ start: node.end + rest.length, end: node.end + rest.length, text: ` // ${text}` })
  }
  /**
   * The rule with the message of the assertion as its last
   * argument: each assertion of ubq takes one. `index` is the
   * place of the message in the arguments of the call.
   */
  const withMessage = (rule: string, index: number, args: Node[]): string =>
    args[index] && args[index].type !== 'ObjectExpression' && rule.endsWith(')')
      ? `${rule.slice(0, -1)}, $${index})`
      : rule
  /** A TODO for the first assertion of the file that is in no test. One is enough for a file. */
  let rootSeen = false
  const rootAssert = (path: Node[]): void => {
    if (!rootSeen) todo(path, TODO.rootAssert)
    rootSeen = true
  }
  /** True if the node is in a loop of its function. */
  const inLoop = (path: Node[]): boolean =>
    path.findLastIndex(n => LOOP.test(n.type)) > path.findLastIndex(n => n.type.includes('Function'))

  /** Removes a statement, with its line if it is alone on the line. */
  const removeLine = (stmt: Node): void => {
    const from = lineStart(stmt.start)
    const end = source.indexOf('\n', stmt.end)
    const alone =
      !source.slice(from, stmt.start).trim() && /^\s*;?\s*$/.test(source.slice(stmt.end, end < 0 ? source.length : end))
    if (alone) replace(from, end < 0 ? source.length : end + 1, '')
    else replace(stmt.start, stmt.end, '')
    changes++
  }
  /** Removes the statement of a call: `t.end()`, `t.plan(3)`. */
  const removeStatement = (path: Node[]): boolean => {
    const stmt = path.at(-2)
    if (stmt?.type !== 'ExpressionStatement') return false
    removeLine(stmt)
    return true
  }
  /** Removes a property of an object literal, with its comma. */
  const removeProperty = (property: Node): void => {
    const after = /^\s*,/.exec(source.slice(property.end))
    const end = property.end + (after?.[0].length ?? 0)
    const lineEnd = source.indexOf('\n', end)
    if (
      !source.slice(lineStart(property.start), property.start).trim() &&
      /^[ \t]*\r?$/.test(source.slice(end, lineEnd))
    )
      replace(lineStart(property.start), lineEnd + 1, '')
    else if (after) replace(property.start, end + /^[ \t]*/.exec(source.slice(end))![0].length, '')
    else replace(source.lastIndexOf(',', property.start), property.end, '')
    changes++
  }

  /** The text from the start of the parameters of a function to their end, with the parentheses. */
  const paramSpan = (fn: Node): [number, number] | undefined => {
    const params = fn.params as Node[]
    // ubq: not measured: the callers give only a function with a parameter
    if (!params.length) return undefined
    const open = source.lastIndexOf('(', params[0]!.start)
    const body = fn.body as Node
    // `t => {}` has no parentheses.
    const head = source.slice(fn.start, params[0]!.start)
    if (open < fn.start || !head.includes('(')) return [params[0]!.start, params.at(-1)!.end]
    const close = source.lastIndexOf(
      ')',
      source.lastIndexOf(fn.type === 'ArrowFunctionExpression' ? '=>' : '{', body.start),
    )
    // ubq: not measured: the parameters in parentheses have a close
    return close > open ? [open, close + 1] : undefined
  }

  /**
   * `it.each(table)(name, fn)` as `for (const row of table)
   * test(name, fn)`, if the change is certain. Each value that the
   * name uses must be a literal, so that the command knows each
   * name. If two rows give one name, the index goes into the name.
   */
  const eachLoop = (node: Node, path: Node[], base: string): boolean => {
    const outer = path.at(-2)
    const statement = path.at(-3)
    const table = (node.arguments as Node[])[0]
    if (
      outer?.type !== 'CallExpression' ||
      outer.callee !== node ||
      statement?.type !== 'ExpressionStatement' ||
      statement.expression !== outer ||
      (node.arguments as Node[]).length !== 1 ||
      table?.type !== 'ArrayExpression'
    )
      return false
    const [title, fn, ...more] = outer.arguments as Node[]
    const rows = table.elements as (Node | null)[]
    if (!title || !fn || more.length || !FUNCTION.has(fn.type) || !rows.length) return false
    const words =
      title.type === 'Literal' && typeof title.value === 'string'
        ? title.value
        : title.type === 'TemplateLiteral' && !(title.expressions as Node[]).length
          ? ((title.quasis as Node[])[0]!.value as { cooked: string }).cooked
          : undefined
    const params = fn.params as (Node & { typeAnnotation?: Node; name?: string })[]
    if (words === undefined || !params.length || rows.some(row => !row || row.type === 'SpreadElement')) return false
    // The value of a literal, as the name shows it.
    const shown = (value: Node | undefined): string | undefined => {
      if (value?.type === 'Literal' && !value.regex && !value.bigint) return String(value.value)
      if (value?.type === 'UnaryExpression' && value.operator === '-' && (value.argument as Node).type === 'Literal')
        return `-${String((value.argument as Node).value)}`
      if (nameOf(value) === 'undefined') return 'undefined'
      return undefined
    }
    const mode = rows.every(row => row!.type === 'ArrayExpression')
      ? 'array'
      : rows.every(row => row!.type === 'ObjectExpression')
        ? 'object'
        : rows.every(row => row!.type !== 'ArrayExpression' && row!.type !== 'ObjectExpression')
          ? 'value'
          : undefined
    if (!mode || (mode !== 'array' && params.length > 1)) return false
    const [param] = params as [(typeof params)[0]]
    // The text of the name, and a function that gives the name of a row.
    let template = ''
    const parts: ((row: Node, index: number) => string | undefined)[] = []
    let index = false
    let arg = 0
    const FORMAT = /%[sdifjp%#]|\$#|\$([A-Za-z_$][\w$]*)(\.\w)?|%[oOc]/g
    let at = 0
    for (const m of words.matchAll(FORMAT)) {
      const literal = words.slice(at, m.index)
      template += literal.replace(/[`\\]|\$\{/g, c => '\\' + c)
      parts.push(() => literal)
      at = m.index + m[0].length
      const spec = m[0]
      if (spec === '%%') {
        template += '%'
        parts.push(() => '%')
      } else if (spec === '%#' || spec === '$#') {
        index = true
        template += '${i}'
        parts.push((_, i) => String(i))
      } else if (spec.startsWith('$')) {
        if (mode !== 'object') {
          template += spec.replace('$', '\\$')
          parts.push(() => spec)
          continue
        }
        const key = m[1]!
        if (m[2]) return false
        let name: string
        if (nameOf(param)) name = `${nameOf(param)}.${key}`
        else if (
          param.type === 'ObjectPattern' &&
          (param.properties as Node[]).some(p => p.type === 'Property' && p.shorthand && nameOf(p.key as Node) === key)
        )
          name = key
        else return false
        template += '${' + name + '}'
        parts.push(row =>
          shown(
            (row.properties as Node[]).find(
              p => p.type === 'Property' && !p.computed && (nameOf(p.key as Node) ?? (p.key as Node).value) === key,
            )?.value as Node | undefined,
          ),
        )
      } else {
        if (mode === 'object' || /%[oOc]/.test(spec)) return false
        const n = arg++
        const target = mode === 'array' ? params[n] : n === 0 ? param : undefined
        if (!nameOf(target)) return false
        // %p shows a value as JSON shows it, for text and numbers.
        const json = spec === '%j' || spec === '%p'
        template += json ? '${JSON.stringify(' + nameOf(target) + ')}' : '${' + nameOf(target) + '}'
        parts.push(row => {
          const value = mode === 'array' ? (row.elements as Node[])[n] : row
          return json && value?.type === 'Literal' ? JSON.stringify(value.value) : shown(value)
        })
      }
    }
    const tail = words.slice(at)
    template += tail.replace(/[`\\]|\$\{/g, c => '\\' + c)
    parts.push(() => tail)
    const names = rows.map((row, i) => parts.map(part => part(row!, i)))
    if (names.some(list => list.includes(undefined))) return false
    const joined = names.map(list => list.join(''))
    if (new Set(joined).size < joined.length) {
      index = true
      template += ' (${i})'
    }
    // The types of the parameters go on the table.
    const typed = params.filter(p => p.typeAnnotation)
    if (typed.length && typed.length !== params.length) return false
    const typeText = (p: (typeof params)[0]): string => text(p.typeAnnotation!.typeAnnotation as Node)
    const optional = (p: (typeof params)[0]): boolean => !!p.optional
    // A row of plain values with no types: `as const` keeps the
    // place of each value, as the table of jest and vitest does.
    // If not, each name of the loop has the type of each value.
    const plain = (value: Node | null): boolean =>
      value?.type === 'Literal' ||
      (value?.type === 'UnaryExpression' && (value.argument as Node).type === 'Literal') ||
      nameOf(value as Node | undefined) === 'undefined'
    const typescript = mode === 'array' && /\.[cm]?tsx?$/.test(file)
    const tuples = typescript && rows.every(row => (row!.elements as (Node | null)[]).every(plain))
    // Rows with other values: `satisfies` makes each row a tuple, so
    // each name of the loop has the type of its place.
    const width = (rows[0]!.elements as (Node | null)[] | undefined)?.length
    const same =
      typescript &&
      width! > 1 &&
      rows.every(
        row =>
          (row!.elements as (Node | null)[]).length === width &&
          (row!.elements as (Node | null)[]).every(value => value && value.type !== 'SpreadElement'),
      )
    const cast = !typed.length
      ? tuples
        ? ' as const'
        : same
          ? ` satisfies [${Array.from({ length: width! }, () => 'unknown').join(', ')}][]`
          : ''
      : ` as ${
          mode === 'array'
            ? `[${params.map(p => typeText(p) + (optional(p) ? '?' : '')).join(', ')}]`
            : optional(param)
              ? `(${typeText(param)} | undefined)`
              : typeText(param)
        }[]`
    if (
      params.some(p => p.type !== 'Identifier' && p.type !== 'ObjectPattern') ||
      (mode === 'array' && params.some(p => !nameOf(p)))
    )
      return false
    const bare = (p: (typeof params)[0]): string =>
      source.slice(p.start, p.typeAnnotation ? p.typeAnnotation.start : p.end).replace(/\??\s*$/, '')
    const binding = mode === 'array' ? `[${params.map(bare).join(', ')}]` : bare(param)
    // The table cannot read a name of the loop: `for (const a of [a])`
    // throws. The index must not hide a name of the test.
    const read = new Set<string>()
    const find = (n: Node): void => {
      if (n.type === 'Identifier') read.add(nameOf(n)!)
      for (const child of children(n))
        if (
          !((n.type === 'Property' || n.type === 'MemberExpression') && !n.computed && child === (n.key ?? n.property))
        )
          find(child)
    }
    find(table)
    const bound = binding.match(/[A-Za-z_$][\w$]*/g)!
    if (bound.some(name => read.has(name)) || (index && mentions(fn, 'i'))) return false
    const wrap = cast && index
    replace(node.start, table.start, `for (const ${index ? `[i, ${binding}]` : binding} of ${wrap ? '(' : ''}`)
    replace(table.end, title.end, `${cast}${wrap ? ')' : ''}${index ? '.entries()' : ''}) ${base}(\`${template}\``)
    const span = paramSpan(fn)!
    replace(span[0], span[1], '()')
    return true
  }

  /** True if `name` is in the text of a node, as a word. */
  const mentions = (node: Node, name: string): boolean =>
    new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(text(node))

  /** `vi.restoreAllMocks()`, `mock.restoreAll()`. */
  const restoresAll = (node: Node | undefined): boolean => {
    const callee = node?.type === 'CallExpression' ? (node.callee as Node) : undefined
    if (callee?.type !== 'MemberExpression') return false
    const owner = roleOf(callee.object as Node)
    const method = nameOf(callee.property as Node)
    return (owner === 'vi' && method === 'restoreAllMocks') || (owner === 'mock' && method === 'restoreAll')
  }
  /** `vi.useRealTimers()`: the clock of fakeClock() ends when its test ends. */
  const realTimers = (node: Node): boolean => {
    const callee = node.type === 'CallExpression' ? (node.callee as Node) : undefined
    return (
      callee?.type === 'MemberExpression' &&
      roleOf(callee.object as Node) === 'vi' &&
      nameOf(callee.property as Node) === 'useRealTimers'
    )
  }
  /** A function that does nothing but put spies and the timers back. */
  const restoresOnly = (fn: Node | undefined): boolean => {
    if (!fn || !FUNCTION.has(fn.type)) return false
    const body = fn.body as Node
    if (body.type !== 'BlockStatement') return restoresAll(body) || realTimers(body)
    const statements = body.body as unknown as Node[]
    return (
      statements.length > 0 &&
      statements.every(
        statement =>
          statement.type === 'ExpressionStatement' &&
          (restoresAll(statement.expression as Node) || realTimers(statement.expression as Node)),
      )
    )
  }
  /** `() => restore()`: gives the name `restore`. */
  const restoreCall = (fn: Node | undefined): string | undefined => {
    if (!fn || !FUNCTION.has(fn.type)) return undefined
    let body = fn.body as Node
    if (body.type === 'BlockStatement') {
      const statements = body.body as unknown as Node[]
      if (statements.length !== 1 || statements[0]!.type !== 'ExpressionStatement') return undefined
      body = statements[0]!.expression as Node
    }
    const name =
      body.type === 'CallExpression' && !(body.arguments as Node[]).length ? nameOf(body.callee as Node) : undefined
    return name && /restore/i.test(name) ? name : undefined
  }
  /** True if the statement of a call is the last one of a function. */
  const lastInFunction = (path: Node[]): boolean => {
    const [fn, block, statement] = path.slice(-4)
    return (
      !!fn &&
      FUNCTION.has(fn.type) &&
      block?.type === 'BlockStatement' &&
      (block.body as unknown as Node[]).at(-1) === statement
    )
  }
  /**
   * `beforeAll(async () => { ... })` at the top level of a file
   * becomes the block `{ ... }` at the same place: code at the top
   * level runs one time, before the tests. Returns the block, or
   * undefined if the change is not certain: the code can use a name
   * that the file declares below it, and that name has no value yet
   * at this place.
   */
  // A file with an import is an ES module, on each runtime. With
  // the `transform` key, the compiler of the project can make
  // CommonJS from it, which has `require` and `__dirname`.
  const esm = !commonjs(file) && (program.body as Node[]).some(n => n.type === 'ImportDeclaration')
  const META = new Map([
    ['__dirname', 'import.meta.dirname'],
    ['__filename', 'import.meta.filename'],
  ])
  /** True if the file makes its own value with this name. */
  const declares = (name: string): boolean =>
    new RegExp(`\\b(const|let|var|function)\\s+${name}\\b|\\b${name}\\s*=[^=]`).test(source)
  const topLevelBlock = (node: Node, path: Node[]): Node | undefined => {
    const statement = path.at(-2)
    const args = node.arguments as Node[]
    const fn = args[0]
    if (statement?.type !== 'ExpressionStatement' || path.at(-3)?.type !== 'Program' || args.length !== 1)
      return undefined
    if (!fn || !FUNCTION.has(fn.type) || (fn.params as Node[]).length) return undefined
    const body = fn.body as Node
    if (body.type !== 'BlockStatement') return undefined
    // A `return` of the function has no meaning in a block.
    const returns = (n: Node): boolean =>
      n.type === 'ReturnStatement' ||
      (!FUNCTION.has(n.type) && n.type !== 'FunctionDeclaration' && children(n).some(returns))
    if (children(body).some(returns)) return undefined
    for (const later of program.body as Node[]) {
      if (later.start < statement.end) continue
      const declared = later.type.startsWith('Export') ? ((later.declaration as Node | undefined) ?? later) : later
      if (declared.type !== 'VariableDeclaration' && declared.type !== 'ClassDeclaration') continue
      const head =
        declared.type === 'ClassDeclaration'
          ? text(declared.id as Node)
          : (declared.declarations as Node[]).map(d => text(d.id as Node)).join(' ')
      for (const name of head.match(/[A-Za-z_$][\w$]*/g) ?? []) if (mentions(body, name)) return undefined
    }
    replace(node.start, body.start, '')
    replace(body.end, statement.end, '')
    changes++
    return body
  }
  /** The calls of the hooks that planSetups changed. */
  const setups = new Set<Node>()
  /** More text for the TODO of a hook that planSetups did not change. */
  const hookNotes = new Map<Node, string[]>()
  /**
   * Makes a setup function from the `beforeEach` and `afterEach`
   * hooks of a scope, and calls it in each test of the scope (D90).
   * A scope is the file, or the function of a `describe`. Only if
   * the change is certain:
   * - The scope has one hook of each kind at most, before its tests.
   * - A hook is a function with a block and no parameters. It
   *   assigns no variable from outside, and has no `return` and no
   *   `this`.
   * - Each statement of the scope that is a call is a test, a
   *   `describe`, a hook, or a call of `vi`: no other function can
   *   make tests there.
   * Not for tap: a hook of tap runs for each subtest too.
   */
  const planSetups = (): void => {
    if ([...roles.values()].includes('tap')) return
    interface Scope {
      hooks: { call: Node; statement: Node }[]
      tests: { call: Node; fn: Node }[]
      inner: Scope[]
      certain: boolean
    }
    const base = (n: Node): Node =>
      n.type === 'MemberExpression' ? base(n.object as Node) : n.type === 'CallExpression' ? base(n.callee as Node) : n
    const read = (statements: Node[], scope: Scope): void => {
      for (const s of statements) {
        if (/^(For|ForOf|ForIn|While|DoWhile|Labeled)Statement$/.test(s.type)) read([s.body as Node], scope)
        else if (s.type === 'BlockStatement') read(s.body as Node[], scope)
        else if (s.type === 'IfStatement') read([s.consequent, s.alternate].filter(Boolean) as Node[], scope)
        else if (s.type === 'TryStatement' || s.type === 'SwitchStatement') scope.certain = false
        if (s.type !== 'ExpressionStatement') continue
        let e = s.expression as Node
        if (e.type === 'AwaitExpression') e = e.argument as Node
        if (e.type !== 'CallExpression') continue
        const role = roleOf(base(e.callee as Node))
        const fn = (e.arguments as Node[]).find(a => FUNCTION.has(a.type))
        const block = fn && (fn.body as Node).type === 'BlockStatement'
        if (role === 'hook') {
          if (nameOf(e.callee as Node)?.endsWith('Each') && !restoresOnly((e.arguments as Node[])[0]))
            scope.hooks.push({ call: e, statement: s })
        } else if (role === 'test') {
          if (fn && !block) scope.certain = false
          else if (fn) scope.tests.push({ call: e, fn })
        } else if (role === 'describe' && block) {
          const child: Scope = { hooks: [], tests: [], inner: [], certain: true }
          read((fn.body as Node).body as Node[], child)
          scope.inner.push(child)
        } else if (role !== 'vi' && role !== 'mock') scope.certain = false
      }
    }
    const all = (scope: Scope): Scope['tests'] => [...scope.tests, ...scope.inner.flatMap(all)]
    const certain = (scope: Scope): boolean => scope.certain && scope.inner.every(certain)
    /** True if the function of a hook can move into a setup function. */
    const plain = (call: Node): boolean => {
      const args = call.arguments as Node[]
      const fn = args[0]
      if (args.length !== 1 || !fn || !FUNCTION.has(fn.type) || (fn.params as Node[]).length) return false
      if ((fn.body as Node).type !== 'BlockStatement' || restoreCall(fn)) return false
      const declared = new Set<string>()
      const names = (n: Node): void => {
        if (n.type === 'VariableDeclarator')
          for (const m of text(n.id as Node).matchAll(/[A-Za-z_$][\w$]*/g)) declared.add(m[0])
        children(n).forEach(names)
      }
      names(fn.body as Node)
      const fine = (n: Node, top: boolean): boolean => {
        if (n.type === 'ThisExpression' || (top && n.type === 'ReturnStatement')) return false
        if (n.type === 'AssignmentExpression' || n.type === 'UpdateExpression') {
          const to = (n.left ?? n.argument) as Node
          if (to.type !== 'MemberExpression' && !declared.has(nameOf(to) ?? '')) return false
        }
        const inner = top && !FUNCTION.has(n.type) && n.type !== 'FunctionDeclaration'
        return children(n).every(child => fine(child, inner))
      }
      return children(fn.body as Node).every(child => fine(child, true))
    }
    const taken = new Set<string>()
    const fresh = (name: string): string => {
      for (let i = 1; ; i++) {
        const next = i === 1 ? name : `${name}${i}`
        if (taken.has(next) || mentions(program, next)) continue
        taken.add(next)
        return next
      }
    }
    const inside = (body: Node, around: Node): string =>
      (body.body as Node[]).length ? indentAt((body.body as Node[])[0]!.start) : `${indentAt(around.start)}  `
    /** `;` if the statements of the file end with one. */
    const semi = /;[ \t]*$/m.test(source) ? ';' : ''
    /**
     * The end of a new statement that the code at `at` comes after.
     * With no `;`, code that starts with `(` or `[` joins the
     * statement before it: `setup()` then `(a as B).c = 1` is a call
     * of the result of `setup()`.
     */
    const endBefore = (at: number): string =>
      semi || (/^(?:\s|\/\/[^\n]*|\/\*[^]*?\*\/)*[([`+\-/]/.test(source.slice(at)) ? ';' : '')
    const note = (hook: Node, text: string): void => {
      hookNotes.set(hook, [...(hookNotes.get(hook) ?? []), text])
    }
    /** `waits`: the hooks of the scopes around this one that are not in a setup function. */
    const plan = (scope: Scope, parent: { name: string; async: boolean } | undefined, waits: Node[]): void => {
      const kind = (k: string): Scope['hooks'] => scope.hooks.filter(h => nameOf(h.call.callee as Node) === k)
      const [before, more] = kind('beforeEach')
      const [after, more2] = kind('afterEach')
      const tests = all(scope)
      const isAsync = !!(before && ((before.call.arguments as Node[])[0] as Node).async) || !!parent?.async
      let mine = parent
      if (
        scope.hooks.length &&
        !more &&
        !more2 &&
        tests.length &&
        certain(scope) &&
        scope.hooks.every(h => plain(h.call) && h.statement.start < Math.min(...tests.map(t => t.call.start))) &&
        // The loop of `each` changes the start of its function.
        (!isAsync || tests.every(t => t.fn.async || (t.call.callee as Node).type !== 'CallExpression'))
      ) {
        mine = { name: fresh('setup'), async: isAsync }
        for (const hook of waits)
          note(
            hook,
            `The function ${mine.name} of a group in this scope does not do the work of this hook. Call the new function at the start of ${mine.name}.`,
          )
        waits = []
        const lines = parent ? [`${parent.async ? 'await ' : ''}${parent.name}()`] : []
        const head = `const ${mine.name} = ${isAsync ? 'async ' : ''}() => {`
        const change = (hook: Scope['hooks'][0], start: (indent: string, end: string) => string, end: string): void => {
          const body = (hook.call.arguments as Node[])[0]!.body as Node
          replace(hook.call.start, body.start + 1, start(inside(body, hook.call), endBefore(body.start + 1)))
          replace(body.end, hook.statement.end, end + endBefore(hook.statement.end))
          setups.add(hook.call)
          changes++
        }
        /** The new lines of a setup function. The last one has `end`. */
        const added = (indent: string, end: string): string =>
          lines.map((line, i) => `\n${indent}${line}${i < lines.length - 1 ? semi : end}`).join('')
        const fnAsync = (hook: Scope['hooks'][0]): string =>
          ((hook.call.arguments as Node[])[0] as Node).async ? 'async ' : ''
        if (after) used.add('cleanup')
        if (before && after) {
          const down = fresh('teardown')
          lines.push(`cleanup(${down})`)
          change(after, () => `const ${down} = ${fnAsync(after)}() => {`, '')
        }
        if (before) change(before, (indent, end) => head + added(indent, end), '')
        else {
          const indent = `${indentAt(after!.call.start)}  `
          change(
            after!,
            () => `${head}${added(indent, semi)}\n${indent}cleanup(${fnAsync(after!)}() => {`,
            `)${semi}\n${indentAt(after!.call.start)}}`,
          )
        }
      }
      if (mine)
        for (const { call, fn } of scope.tests) {
          const body = fn.body as Node
          const text = `${mine.async ? 'await ' : ''}${mine.name}()${endBefore(body.start + 1)}`
          const empty = !(body.body as Node[]).length
          edits.push({
            start: body.start + 1,
            end: body.start + 1,
            text: empty ? ` ${text} ` : `\n${inside(body, call)}${text}`,
          })
          if (mine.async && !fn.async && !madeAsync.has(fn)) {
            edits.push({ start: fn.start, end: fn.start, text: 'async ' })
            madeAsync.add(fn)
          }
        }
      // The hooks of this scope that stay as they are.
      const left = scope.hooks.map(h => h.call).filter(hook => !setups.has(hook))
      if (mine)
        for (const hook of left)
          note(
            hook,
            `Each test of this group calls ${mine.name}() at its start, and that work ran before this hook. Call the new function after ${mine.name}().`,
          )
      for (const child of scope.inner) plan(child, mine, [...waits, ...left])
    }
    const top: Scope = { hooks: [], tests: [], inner: [], certain: true }
    read(program.body as Node[], top)
    plan(top, undefined, [])
  }
  const inHook = (path: Node[]): boolean =>
    path.some(n => n.type === 'CallExpression' && roleOf(n.callee as Node) === 'hook')

  /**
   * The TODO text for `vi.spyOn(ns, 'k')`, where `ns` is `import *
   * as ns`. The exports of a module cannot change, so the spy of
   * ubq cannot replace one.
   */
  const namespaceSpy = (node: Node): string | undefined => {
    const callee = node.type === 'CallExpression' ? (node.callee as Node) : undefined
    if (callee?.type !== 'MemberExpression' || callee.computed) return undefined
    const owner = roleOf(callee.object as Node)
    const maker = nameOf(callee.property as Node)
    if (!(owner === 'vi' && maker === 'spyOn') && !(owner === 'mock' && maker === 'method')) return undefined
    const [object, key] = node.arguments as Node[]
    const name = nameOf(object)
    const module = namespaces.get(name!)
    if (!module) return undefined
    const k = key?.type === 'Literal' && typeof key.value === 'string' ? key.value : 'name'
    return `spyOn cannot replace an export of a module: ${name} is the module '${module}', and the code under test has its own import of it. Use mockImport: const subject = await mockImport(() => import('<the module under test>'), [[() => import('${module}'), { ...${name}, ${k}: spy(impl) }]]). Then call the code of subject, not of the import at the top of the file, and assert on the spy.`
  }
  /**
   * The TODO text for a spy assertion on a name that is an import
   * of the project, where the file replaces that module: the name
   * is the real export, not a spy.
   */
  const realImport = (subject: Node): string | undefined => {
    const name = nameOf(subject)
    const module = name === undefined ? undefined : imported.get(name)
    const real =
      module !== undefined
        ? mocked.has(module) || [...namespaces.values()].includes(module)
        : subject.type === 'MemberExpression' && !subject.computed && namespaces.has(nameOf(subject.object as Node)!)
    return real
      ? `${text(subject)} is the real export of its module, not a spy. Make a spy, give it to mockImport in place of the export, and assert on that spy.`
      : undefined
  }
  /** The calls whose arguments become a pattern of `assert.match` or `isMatch`. */
  const patterns = new Set<Node>()
  /** `expect.name(...)`: the name and the arguments. */
  const matcherOf = (node: Node | null): { name: string; args: Node[] } | undefined => {
    const callee = node?.type === 'CallExpression' ? (node.callee as Node) : undefined
    if (callee?.type !== 'MemberExpression' || callee.computed || roleOf(callee.object as Node) !== 'expect')
      return undefined
    // A property that is not computed has a name.
    return { name: nameOf(callee.property as Node)!, args: node!.arguments as Node[] }
  }
  /** True if the node has a matcher of `expect` in it. */
  const hasMatcher = (node: Node): boolean => !!matcherOf(node) || children(node).some(hasMatcher)
  /**
   * True if a pattern does the same check as this expected value
   * of an exact comparison. A pattern permits keys that it does not
   * have, so an object is only in `objectContaining`, and each of
   * its values is a plain value or a matcher.
   */
  const exactPattern = (node: Node | null): boolean => {
    if (!node) return false
    const matcher = matcherOf(node)
    if (matcher) {
      const [first, more] = matcher.args
      if (matcher.name === 'anything') return !first
      if (!first || more) return false
      if (matcher.name === 'any') return /^(Identifier|MemberExpression)$/.test(first.type) && !mentions(first, 'v')
      if (matcher.name === 'stringMatching') return !!first.regex
      if (matcher.name === 'stringContaining') return first.type === 'Literal' && typeof first.value === 'string'
      return (
        matcher.name === 'objectContaining' &&
        first.type === 'ObjectExpression' &&
        (first.properties as Node[]).every(p => p.type === 'Property' && !p.computed && exactPattern(p.value as Node))
      )
    }
    if (node.type === 'ArrayExpression') return (node.elements as (Node | null)[]).every(exactPattern)
    if (node.type === 'UnaryExpression') return (node.argument as Node).type === 'Literal'
    return node.type === 'TemplateLiteral' || (node.type === 'Literal' && !node.regex) || nameOf(node) === 'undefined'
  }
  /** True if the arguments of a spy check have a matcher, and a pattern does the same check. */
  const patternArgs = (node: Node, args: Node[]): boolean => {
    const found = args.some(hasMatcher) && args.every(exactPattern)
    if (found) patterns.add(node)
    return found
  }

  /**
   * True if a matcher of `expect` in the arguments of a call is in
   * a pattern: the call becomes `assert.match`, `assert.throws`, or
   * `assert.rejects`, where a RegExp tests a string.
   */
  const inPattern = (path: Node[]): boolean => {
    for (let i = path.length - 2; i >= 0; i--) {
      if (patterns.has(path[i]!)) return true
      const callee = path[i]!.type === 'CallExpression' ? (path[i]!.callee as Node) : undefined
      if (callee?.type !== 'MemberExpression') continue
      let base = callee.object as Node
      while (base.type === 'MemberExpression' && /^(not|resolves|rejects)$/.test(String(nameOf(base.property as Node))))
        base = base.object as Node
      if (base.type === 'CallExpression' && roleOf(base.callee as Node) === 'expect')
        return /^(toMatchObject|toThrow|toThrowError)$/.test(String(nameOf(callee.property as Node)))
    }
    return false
  }

  /**
   * `vi.spyOn(o, 'k').mockImplementation(f)` becomes
   * `spyOn(o, 'k', f)`. `vi.fn().mockReturnValue(v)` becomes
   * `spy(() => v)`. Returns the nodes to walk next.
   */
  const spyChain = (node: Node, made: Node, method: string): Node[] | undefined => {
    const value = (node.arguments as Node[])[0]
    const wrap = (
      {
        mockImplementation: ['', ''],
        mockReturnValue: ['() => ', ''],
        mockResolvedValue: ['async () => ', ''],
        mockRejectedValue: ['async () => { throw ', ' }'],
      } as Record<string, [string, string]>
    )[method]
    if (!wrap || !value || (node.arguments as Node[]).length !== 1 || made.type !== 'CallExpression') return undefined
    const callee = made.callee as Node
    const inner = made.arguments as Node[]
    if (callee.type !== 'MemberExpression' || callee.computed) return undefined
    const owner = roleOf(callee.object as Node)
    const maker = nameOf(callee.property as Node)
    const name =
      owner !== 'vi' && owner !== 'mock'
        ? undefined
        : maker === 'fn' && !inner.length
          ? 'spy'
          : (maker === 'spyOn' || (owner === 'mock' && maker === 'method')) && inner.length === 2
            ? 'spyOn'
            : undefined
    if (!name) return undefined
    // `() => {}` with an object in it is a block, also for `{} as T`.
    const [before, after] =
      method !== 'mockImplementation' && source[value.start] === '{' && !wrap[1] ? [wrap[0] + '(', ')'] : wrap
    // `vi\n  .spyOn(o, 'k')\n  .mockImplementation(f)`: f moves to the line of `vi`.
    if (lineStart(value.start) !== lineStart(callee.start))
      shifts.push({
        start: value.start,
        end: value.end,
        by: indentAt(callee.start).length - indentAt(value.start).length,
      })
    replace(callee.start, callee.end, name)
    replace(inner.at(-1)?.end ?? callee.end, value.start, (inner.length ? ', ' : '(') + before)
    replace(value.end, node.end, after + ')')
    used.add(name)
    changes++
    return [...inner, value]
  }

  /**
   * `s.mock.calls.length` becomes `s.calls.length`, and
   * `s.mock.calls[0][1]` becomes `s.calls[0].args[1]`. `path` ends
   * at the node of `s.mock`.
   */
  const spyCalls = (node: Node, path: Node[]): boolean => {
    const calls = path.at(-2)!
    const use = path.at(-3)
    if (nameOf(calls.property as Node) !== 'calls' || use?.type !== 'MemberExpression' || use.object !== calls)
      return false
    if (!use.computed) {
      if (nameOf(use.property as Node) !== 'length') return false
    } else {
      // `s.mock.calls[0]!` has one more node around it.
      const outer = path.at(-4)?.type === 'TSNonNullExpression' ? path.at(-4)! : use
      const next = path.at(outer === use ? -4 : -5)
      const optional = next?.type === 'MemberExpression' && next.object === outer && next.optional
      edits.push({ start: outer.end, end: outer.end, text: optional ? '?.args' : '.args' })
    }
    // From the name `mock`: the object can end with a `)`.
    replace((node.property as Node).start, calls.end, 'calls')
    changes++
    return true
  }

  // --- The rules ---
  /**
   * Playwright: test(name, async ({ page }) => {}). The page is a
   * call of `browser()` now, at the start of the test.
   */
  const pageFixtures = (call: Node, fn: Node, path: Node[]): void => {
    const body = fn.body as Node
    const first = (fn.params as Node[])[0]!
    const names =
      first.type === 'ObjectPattern' && (fn.params as Node[]).length === 1
        ? (first.properties as Node[]).map(p =>
            p.type === 'Property' && !p.computed ? [nameOf(p.key as Node), nameOf(p.value as Node)] : [],
          )
        : undefined
    const local = (key: string): string | undefined => names?.find(([k]) => k === key)?.[1]
    if (
      !names ||
      body.type !== 'BlockStatement' ||
      names.some(([key, value]) => !value || (key !== 'page' && key !== 'context')) ||
      // A name of the file hides the import.
      mentions(program, 'browser')
    )
      return todo(path, TODO.fixture)
    const lines: string[] = []
    if (local('page')) lines.push(`const ${local('page')} = await browser()`)
    if (local('context'))
      lines.push(
        `const ${local('context')} = ${local('page') ? `${local('page')}.context()` : '(await browser()).context()'}`,
      )
    const inner = body.body as Node[]
    const indent = inner.length ? indentAt(inner[0]!.start) : `${indentAt(call.start)}  `
    // The form of the statements of the file.
    const end = /;\s*$/m.test(source) ? ';' : ''
    if (lines.length) {
      usesBrowser = true
      edits.push({
        start: body.start + 1,
        end: body.start + 1,
        text:
          lines.map(line => `\n${indent}${line}${end}`).join('') + (inner.length ? '' : `\n${indentAt(call.start)}`),
      })
      if (!fn.async && !madeAsync.has(fn)) {
        edits.push({ start: fn.start, end: fn.start, text: 'async ' })
        madeAsync.add(fn)
      }
    }
    const span = paramSpan(fn)!
    replace(span[0], span[1], '()')
    changes++
  }

  /** A test or a group: `it(...)`, `test(...)`, `t.test(...)`, `describe(...)`. */
  const definition = (call: Node, path: Node[], kind: 'test' | 'describe', fromTap: boolean): void => {
    const args = call.arguments as Node[]
    const callee = call.callee as Node
    const fn = args.find(a => FUNCTION.has(a.type))
    let name: 'test' | 'describe' = kind
    // The ID of a test is `file > group > test`.
    const title = args[0]
    if (
      (title?.type === 'Literal' && typeof title.value === 'string' && title.value.includes(' > ')) ||
      (title?.type === 'TemplateLiteral' && text(title).includes(' > '))
    )
      todo(path, TODO.separator)
    // ava: test(name, macro, value)
    if (!fn && framework === 'ava' && args.length > 1) todo(path, TODO.macro)
    if (fn) {
      const param = nameOf((fn.params as Node[])[0])
      const body = fn.body as Node
      if (fromTap && param) {
        roles.set(param, 'tap')
        const direct = body.type === 'BlockStatement' ? (body.body as Node[]) : []
        const isSub = (s: Node): boolean => {
          let e = s.type === 'ExpressionStatement' ? (s.expression as Node) : undefined
          if (e?.type === 'AwaitExpression') e = e.argument as Node
          const c = e?.type === 'CallExpression' ? (e.callee as Node) : undefined
          return (
            c?.type === 'MemberExpression' &&
            nameOf(c.object as Node) === param &&
            nameOf(c.property as Node) === 'test'
          )
        }
        // `for (const c of cases) t.test(c, ...)`: subtests in a loop.
        const subLoop = (s: Node): boolean => LOOP.test(s.type) && text(s).includes(`${param}.test(`)
        /** True if the code awaits, and not in a function that is in it. */
        const awaits = (n: Node): boolean =>
          n.type === 'AwaitExpression' ||
          children(n).some(c => !FUNCTION.has(c.type) && c.type !== 'FunctionDeclaration' && awaits(c))
        if (direct.some(s => isSub(s) || subLoop(s))) {
          name = 'describe'
          // Not the end or the plan of the parent: they go away.
          const rest = direct.filter(s => !isSub(s) && !subLoop(s) && !/^\s*\w+\.(end|plan)\(/.test(text(s)))
          // The rest of the body must be in a test.
          const own = rest.filter(s => mentions(s, param))
          // Also the loop itself: `for await (...) t.test(...)`.
          const waits = rest.some(awaits) || direct.some(s => s.type === 'ForOfStatement' && s.await === true)
          if (own.length || waits) todo(path, TODO.subtests)
          // Code that does work, and that tap ran when the test ran.
          else if (rest.some(s => s.type === 'ExpressionStatement')) todo(path, TODO.describeBody)
          // The function of a describe is not async. With an await
          // in it, the function stays as it is until the TODO is done.
          if (fn.async && !waits)
            replace(fn.start, fn.start + 'async'.length + (source[fn.start + 5] === ' ' ? 1 : 0), '')
        }
        // A test that ends in a callback returns a promise, and the
        // callback resolves it.
        const ends: Node[] = []
        let callback = false
        const find = (n: Node, depth: number): void => {
          const inner = FUNCTION.has(n.type) || n.type === 'FunctionDeclaration'
          // A parameter with the same name is a different test object.
          if (inner && (n.params as Node[]).some(p => nameOf(p) === param)) return
          const c = n.type === 'CallExpression' ? (n.callee as Node) : undefined
          if (
            c?.type === 'MemberExpression' &&
            nameOf(c.object as Node) === param &&
            nameOf(c.property as Node) === 'end' &&
            !(n.arguments as Node[]).length
          ) {
            ends.push(n)
            callback ||= depth > 0
          }
          for (const child of children(n)) find(child, depth + (inner ? 1 : 0))
        }
        find(body, 0)
        const span = paramSpan(fn)
        if (callback && name === 'test' && !fn.async && body.type === 'BlockStatement' && !mentions(body, 'this')) {
          const end = ['end', 'done', 'ended'].find(n => !mentions(program, n)) ?? 'endTest'
          for (const one of ends) endCalls.set(one, end)
          promised.add(fn)
          replace(fn.start, body.start, `() => new Promise${/\.[cm]?tsx?$/.test(file) ? '<void>' : ''}(${end} => `)
          edits.push({ start: body.end, end: body.end, text: ')' })
          changes++
        } else if (span) replace(span[0], span[1], '()')
      } else if (framework === 'playwright' && kind === 'test' && (fn.params as Node[]).length) {
        pageFixtures(call, fn, path)
      } else if (param && kind === 'test') {
        // The test object of node:test, or the done callback of jest.
        if (mentions(body, param))
          todo(path, framework === 'node:test' || framework === 'bun:test' ? TODO.context : TODO.done)
        else {
          const span = paramSpan(fn)
          if (span) replace(span[0], span[1], '()')
        }
      }
      // jest: it(name, fn, timeout)
      const after = args[args.indexOf(fn) + 1]
      if (after && args.indexOf(fn) === 1) {
        edits.push({ start: fn.start, end: fn.start, text: `{ timeout: ${text(after)} }, ` })
        replace(fn.end, after.end, '')
      }
    }
    for (const option of args.filter(a => a.type === 'ObjectExpression'))
      for (const prop of option.properties as Node[]) {
        const key = nameOf(prop.key as Node)
        const value = prop.value as Node | undefined
        if (
          key === 'skip' &&
          !(value?.type === 'Literal' && typeof value.value === 'string') &&
          value?.type !== 'TemplateLiteral'
        )
          todo(path, TODO.skip)
        if (key === 'only') todo(path, TODO.only)
        if (key === 'todo') todo(path, TODO.skip)
        // tap has options that ubq does not have: bail, jobs, buffered.
        if (fromTap && key && !/^(skip|only|todo|timeout)$/.test(key))
          todo(path, `ubq has the options skip and timeout. Remove "${key}" from the options of this test.`)
      }
    used.add(name)
    if (text(callee) !== name) changes++
    replace(callee.start, callee.end, name)
  }

  const walk = (node: Node, path: Node[]): void => {
    if (drop.has(node.start)) {
      if (node.type === 'Property') return removeProperty(node)
      if (node.type === 'ExpressionStatement' || node.type === 'VariableDeclaration') return removeLine(node)
    }
    path = [...path, node]
    let next: Node[] | undefined
    const parent = path.at(-2)
    /** True if the name is a value, and not the name of a key or of a property. */
    const reference =
      node.type === 'Identifier' &&
      !(parent?.type === 'MemberExpression' && parent.property === node && !parent.computed) &&
      !(parent?.type === 'Property' && parent.key === node && !parent.computed && !parent.shorthand)
    if (esm && reference && nameOf(node) === 'require' && !declares('require')) todo(path, TODO.require)
    // `return it`, `const run = cond ? it : it.skip`: the test
    // function as a value, in a helper file.
    if (reference && importedRoles.has(nameOf(node)!) && /^(test|describe)$/.test(roleOf(node)!)) {
      let top = node
      let at = path.length - 2
      while (path[at]?.type === 'MemberExpression' && path[at]!.object === top) top = path[at--]!
      const user = path[at]
      const called =
        (user?.type === 'CallExpression' && user.callee === top) ||
        (user?.type === 'TaggedTemplateExpression' && user.tag === top)
      const hidden =
        path.some(n => n.type === 'ImportDeclaration' || removed.includes(n)) ||
        path.some(
          n =>
            (FUNCTION.has(n.type) || n.type === 'FunctionDeclaration') &&
            (n.params as Node[]).some(p => mentions(p, nameOf(node)!)),
        )
      if (!called && !hidden) {
        const role = roleOf(node) as 'test' | 'describe'
        replace(node.start, node.end, role)
        used.add(role)
        if (nameOf(node) !== role) changes++
        if (top !== node) todo(path, TODO.testValue)
      }
    }
    if (node.type === 'TSTypeReference' && toolTypes.has(nameOf(node.typeName as Node)!)) todo(path, TODO.mockType)
    // chromium.launch() of the Playwright library, with any test tool.
    if (node.type === 'CallExpression') {
      const callee = node.callee as Node
      if (
        callee.type === 'MemberExpression' &&
        nameOf(callee.property as Node) === 'launch' &&
        launchers.has(nameOf(callee.object as Node)!)
      )
        todo(path, TODO.launch)
    }
    // jest.Mocked<Service>, vi.Mock: a type of the old tool.
    if (node.type === 'TSQualifiedName' && roleOf(node.left as Node) === 'vi') todo(path, TODO.mockType)
    // t.jobs = 64
    if (node.type === 'AssignmentExpression') {
      const left = node.left as Node
      if (left.type === 'MemberExpression' && roleOf(left.object as Node) === 'tap') todo(path, TODO.tapSetting)
    }
    if (!compiler && node.type === 'TSEnumDeclaration' && !node.declare) todo(path, TODO.enum)
    if (!compiler && node.type === 'TSParameterProperty') todo(path, TODO.parameterProperty)
    const meta = esm && META.get(nameOf(node) ?? '')
    if (meta && !declares(nameOf(node)!)) {
      // { __dirname } has the name as its key and as its value.
      if (parent?.type === 'Property' && parent.shorthand) {
        if (parent.key === node) replace(node.start, node.end, `${nameOf(node)}: ${meta}`)
        changes++
      } else if (
        !(
          (parent?.type === 'MemberExpression' && parent.property === node && !parent.computed) ||
          (parent?.type === 'Property' && parent.key === node && !parent.computed)
        )
      ) {
        replace(node.start, node.end, meta)
        changes++
      }
    }
    if (node.type === 'CallExpression') next = call(node, path)
    else if (node.type === 'MemberExpression') {
      // spy.mock.calls of jest and vitest
      const read =
        nameOf(node.property as Node) === 'mock' && parent?.type === 'MemberExpression' && parent.object === node
          ? (nameOf(parent.property as Node) ?? '')
          : ''
      if (/^(calls|results|lastCall)$/.test(read)) {
        if (!spyCalls(node, path)) todo(path, TODO.spyImpl)
      } else if (/^(instances|contexts)$/.test(read)) todo(path, TODO.spyThis)
      else if (/^(invocationCallOrder|settledResults)$/.test(read)) todo(path, TODO.spyImpl)
      // mock.timers.enable() of node:test
      else if (roleOf(node.object as Node) === 'mock' && nameOf(node.property as Node) === 'timers')
        todo(path, TODO.timers)
    } else if (node.type === 'TaggedTemplateExpression') {
      // it.each`a | b`
      const tag = node.tag as Node
      const owner = tag.type === 'MemberExpression' ? roleOf(tag.object as Node) : undefined
      if ((owner === 'test' || owner === 'describe') && nameOf(tag.property as Node) === 'each') {
        todo(path, owner === 'describe' ? TODO.eachGroup : TODO.each)
        used.add(owner)
      }
    } else if (node.type === 'Identifier' && roleOf(node) === 'tap') {
      // helper(t, value)
      const parent = path.at(-2)
      if (parent?.type === 'CallExpression' && (parent.arguments as Node[]).includes(node)) todo(path, TODO.passed)
      else if (
        parent?.type === 'MemberExpression' &&
        parent.object === node &&
        nameOf(parent.property as Node) === 'context'
      )
        todo(path, TODO.avaContext)
    }
    for (const child of next ?? children(node)) walk(child, path)
  }

  /** Changes a call. Returns the nodes to walk next, or undefined for all children. */
  const call = (node: Node, path: Node[]): Node[] | undefined => {
    const callee = node.callee as Node
    const args = node.arguments as Node[]
    const role = roleOf(callee)
    // fail('text') is a global of jest.
    if (framework === 'jest' && nameOf(callee) === 'fail' && !declares('fail') && args.length < 2)
      return rewrite(node, args.length ? 'assert.fail($0)' : "assert.fail('fail')", args)
    if (role === 'test' || role === 'describe') {
      definition(node, path, role, tapTests.has(nameOf(callee)!))
      return args
    }
    if (role === 'hook') {
      if (setups.has(node)) return [args[0]!.body as Node]
      if (restoresOnly(args[0]) && removeStatement(path)) return []
      // roleOf gives a role only to a name.
      const once = /^(before|after)(All)?$/.exec(nameOf(callee)!)
      const inner = path.some(n => FUNCTION.has(n.type) || n.type === 'FunctionDeclaration')
      if (once?.[1] === 'before' && !inner) {
        const body = topLevelBlock(node, path)
        if (body) return [body]
      }
      const restore = restoreCall(args[0])
      const more =
        hookNotes
          .get(node)
          ?.map(text => ` ${text}`)
          .join('') ?? ''
      todo(
        path,
        (restore
          ? `If this only puts spies back, delete it, each assignment to ${restore}, and each call of ${restore}() or of the function that was assigned. Then remove that function from the helper that gives it. A spyOn spy goes back when its test ends, and a second spyOn on a key replaces the first. If it does other work: ${TODO.hook}`
          : !once
            ? TODO.hook
            : inner
              ? TODO.hookGroup
              : once[1] === 'before'
                ? TODO.hookFile
                : TODO.hookFileEnd) + more,
      )
      return undefined
    }
    if (role === 'assert') {
      // `import * as check from 'node:assert'`: the name goes away
      // with the import.
      replace(callee.start, callee.end, 'assert')
      used.add('assert')
      return undefined
    }
    if (role?.startsWith('assert.')) return assertCall(node, path, role.slice('assert.'.length))
    if (role?.startsWith('cf.')) {
      const name = role.slice('cf.'.length)
      const to = WORKERS[name]!
      const first = args[0]
      if (name === 'waitOnExecutionContext' && first) {
        // waitOnExecutionContext(ctx) becomes ctx.settled()
        const wrap = !SIMPLE.has(first.type)
        replace(node.start, first.start, wrap ? '(' : '')
        replace(first.end, node.end, `${wrap ? ')' : ''}.settled()`)
      } else if (name === 'applyD1Migrations') {
        // applyD1Migrations(env.DB, env.TEST_MIGRATIONS) becomes migrate('DB')
        const binding =
          first?.type === 'MemberExpression' && !first.computed ? nameOf(first.property as Node) : undefined
        if (!binding) {
          todo(
            path,
            "Use migrate('DB') of 'ubqtest/workers', with the name of the D1 binding. It applies the files of migrations_dir in the wrangler config.",
          )
          return undefined
        }
        replace(node.start, node.end, `migrate('${binding}')`)
        workersUsed.add(to)
        changes++
        return []
      } else if (name === 'waitOnExecutionContext') {
        todo(path, 'Use the settled() method of the context: await ctx.settled().')
        return undefined
      } else replace(callee.start, callee.end, to)
      if (name !== 'waitOnExecutionContext') workersUsed.add(to)
      changes++
      return args
    }
    if (callee.type !== 'MemberExpression' || callee.computed) return undefined
    const object = callee.object as Node
    const named = nameOf(callee.property as Node)
    if (!named) return undefined
    const method = ALIAS[named] ?? named
    // expect.not.stringContaining('text') is a matcher of expect too.
    const negated =
      object.type === 'MemberExpression' &&
      nameOf(object.property as Node) === 'not' &&
      roleOf(object.object as Node) === 'expect'
    // ava: test.serial.only(name, fn), test.after.always(fn)
    const first = object.type === 'MemberExpression' ? (object.object as Node) : object
    const ofTap = roleOf(first) === 'test' && tapTests.has(nameOf(first)!)
    const middle = first === object ? undefined : nameOf(object.property as Node)
    if (ofTap && (HOOKS.has(method) || (middle && HOOKS.has(middle)))) {
      todo(path, TODO.hook)
      return undefined
    }
    if (ofTap && !middle && method === 'serial') {
      definition(node, path, 'test', true)
      return args
    }
    const owner = negated ? 'expect' : ofTap && middle === 'serial' ? 'test' : roleOf(object)
    // The test object of a test with a modifier: test.only(name, t => {})
    if (ofTap) {
      const fn = args.find(a => FUNCTION.has(a.type))
      const param = nameOf((fn?.params as Node[] | undefined)?.[0])
      const span = param && paramSpan(fn!)
      if (param) roles.set(param, 'tap')
      if (span) replace(span[0], span[1], '()')
    }

    if (framework === 'playwright') {
      // test.describe(name, fn), test.describe.serial(name, fn)
      const group = (n: Node): boolean =>
        n.type === 'MemberExpression' &&
        roleOf(n.object as Node) === 'test' &&
        nameOf(n.property as Node) === 'describe'
      if (group(callee) || (group(object) && (method === 'serial' || method === 'parallel'))) {
        definition(node, path, 'describe', false)
        return args
      }
      const name = args[0]?.type === 'Literal' || args[0]?.type === 'TemplateLiteral'
      const hint =
        owner !== 'test'
          ? undefined
          : HOOKS.has(method)
            ? TODO.pageHook
            : method === 'step'
              ? TODO.step
              : method === 'use'
                ? TODO.use
                : method === 'setTimeout' || method === 'slow'
                  ? TODO.testTimeout
                  : (method === 'skip' || method === 'fixme') && !name
                    ? TODO.skipIn
                    : undefined
      if (hint) {
        todo(path, hint)
        return undefined
      }
    }
    if (owner === 'tap') return tapCall(node, path, method)
    if (owner === 'assert') return assertCall(node, path, method)
    if (owner === 'test' || owner === 'describe') {
      // it.skip, describe.only, test.todo, test.each
      const base = owner
      const fn = args.find(a => FUNCTION.has(a.type))
      if (
        framework === 'playwright' &&
        owner === 'test' &&
        fn &&
        (fn.params as Node[]).length &&
        /^(skip|fixme|only)$/.test(method)
      )
        pageFixtures(node, fn, path)
      if ((method === 'skip' || (method === 'fixme' && framework === 'playwright')) && args[0]) {
        replace(callee.start, callee.end, base)
        edits.push({ start: args[0].end, end: args[0].end, text: ", { skip: 'TODO(ubq): the reason' }" })
        todo(path, TODO.skip)
      } else if (method === 'only') {
        replace(callee.start, callee.end, base)
        todo(path, TODO.only)
      } else if (method === 'todo' && args.length === 1) {
        replace(callee.start, callee.end, base)
        edits.push({ start: args[0]!.end, end: args[0]!.end, text: ", { skip: 'todo' }, () => {}" })
      } else if (method === 'each' && eachLoop(node, path, base)) {
        used.add(base)
        changes++
        return []
      } else {
        todo(
          path,
          method === 'each'
            ? base === 'describe'
              ? TODO.eachGroup
              : TODO.each
            : method === 'runIf' || method === 'skipIf'
              ? `Use an option of ${base}(): { skip: ${method === 'runIf' ? '!' : ''}condition && 'the reason' }.`
              : `ubq has no ${base}.${method}.`,
        )
        // The name stays in the code, and the change of the TODO uses it.
        used.add(base)
        return undefined
      }
      used.add(base)
      changes++
      return args
    }
    if (owner === 'expect') {
      // expect.any(Number), expect.stringContaining('text')
      const first = args[0]
      if (method === 'fail' && args.length < 2) {
        used.add('assert')
        return rewrite(node, args.length ? 'assert.fail($0)' : "assert.fail('fail')", args)
      }
      // A RegExp does the work of stringMatching with a RegExp.
      if (method === 'stringMatching' && args.length === 1 && first!.regex && !negated && inPattern(path)) {
        replace(node.start, first!.start, '')
        replace(first!.end, node.end, '')
        changes++
        return []
      }
      if (
        method === 'stringContaining' &&
        args.length === 1 &&
        first?.type === 'Literal' &&
        typeof first.value === 'string' &&
        !negated &&
        inPattern(path)
      ) {
        replace(node.start, first.start, '')
        messageRegExp(first)
        replace(first.end, node.end, '')
        changes++
        return []
      }
      // A partial object does the work of objectContaining.
      if (method === 'objectContaining' && !negated && exactPattern(node) && inPattern(path)) {
        replace(node.start, first!.start, '')
        replace(first!.end, node.end, '')
        changes++
        return [first!]
      }
      // In a pattern, a function is a predicate for the value.
      const kind = first && args.length === 1 && /^(Identifier|MemberExpression)$/.test(first.type) ? text(first) : ''
      const check =
        method === 'anything' && !args.length
          ? 'v != null'
          : method !== 'any' || !kind || mentions(first!, 'v')
            ? undefined
            : /^(Number|String|Boolean|Function|BigInt|Symbol|Object)$/.test(kind)
              ? `typeof v === '${kind.toLowerCase()}'`
              : kind === 'Array'
                ? 'Array.isArray(v)'
                : `v instanceof ${kind}`
      // The expected value of assert.throws is not a pattern at
      // its top level: a function there is a class.
      if (
        check &&
        !negated &&
        (path.at(-2)!.type !== 'CallExpression' || patterns.has(path.at(-2)!)) &&
        inPattern(path)
      ) {
        replace(node.start, node.end, `${/\.[cm]?tsx?$/.test(file) ? '(v: unknown)' : 'v'} => ${check}`)
        changes++
        return []
      }
      todo(path, method === 'assertions' || method === 'hasAssertions' ? TODO.assertions : TODO.matcher)
      return undefined
    }
    if (owner === 'vi' || owner === 'mock') {
      if (method === 'fn') {
        // `const s = vi.fn() as T` hides the type of the spy, and
        // then `s.calls` is a type error.
        let outer = node
        let i = path.length - 2
        while (path[i]?.type === 'TSAsExpression') outer = path[i--]!
        if (outer !== node && path[i]?.type === 'VariableDeclarator') replace(node.end, outer.end, '')
        replace(callee.start, callee.end, 'spy')
        used.add('spy')
        changes++
      } else if (method === 'spyOn' || (owner === 'mock' && method === 'method')) {
        const real = namespaceSpy(node)
        if (real) {
          todo(path, real)
          return undefined
        }
        replace(callee.start, callee.end, 'spyOn')
        used.add('spyOn')
        changes++
      } else if (method === 'stubGlobal' && args.length === 2 && args[0]!.type !== 'SpreadElement') {
        replace(callee.start, args[0]!.start, 'stub(globalThis, ')
        used.add('stub')
        changes++
      } else if (method === 'stubEnv' && args.length === 2 && args[0]!.type !== 'SpreadElement') {
        const [name, value] = args as [Node, Node]
        const plain = name.type === 'Literal' && /^[A-Za-z_$][\w$]*$/.test(String(name.value))
        replace(callee.start, name.start, plain ? 'env({ ' : 'env({ [')
        if (plain) replace(name.start, name.end, String(name.value))
        replace(name.end, value.start, plain ? ': ' : ']: ')
        replace(value.end, node.end, ' })')
        used.add('env')
        changes++
      } else if (restoresAll(node)) {
        // ubq does this when each test ends. ubq has no call that
        // does it before, so the call cannot stay.
        if (!removeStatement(path)) todo(path, TODO.restore)
        else if (!(inHook(path) || lastInFunction(path))) todo(path, TODO.restored)
        return []
      } else
        todo(
          path,
          VI[method] ??
            (/mock|Mock|module/.test(method)
              ? TODO.mock
              : /[Tt]imer|Time/.test(method)
                ? TODO.timers
                : `ubq has no ${nameOf(object)}.${method}.`),
        )
      return undefined
    }
    if (/^mock(Implementation|ReturnValue|ResolvedValue|RejectedValue|Reset|Clear|Restore)(Once)?$/.test(method)) {
      // The walk gives the TODO to the `spyOn` call of a namespace.
      const real = namespaceSpy(object)
      const found = real ? undefined : spyChain(node, object, method)
      if (found || real) return found
      if (method !== 'mockRestore') {
        todo(path, /^mock(Clear|Reset)$/.test(method) ? TODO.spyClear : TODO.spyImpl)
        return undefined
      }
      // `{ restore: () => spy.mockRestore() }`: a helper gives the
      // function to its callers, and they can call it in a test.
      const fn = path.findLastIndex(n => FUNCTION.has(n.type))
      const key = fn > 0 && path[fn - 1]!.type === 'Property' ? text(path[fn - 1]!.key as Node) : undefined
      if (key) {
        todo(
          path,
          `${TODO.restore} The callers of the helper get this function as "${key}". In the test files, remove each call and each assignment of it, and each hook that only calls it. Then remove this function.`,
        )
        return undefined
      }
      if (removeStatement(path)) {
        if (!(inHook(path) || lastInFunction(path))) todo(path, TODO.restored)
        return []
      }
      todo(path, TODO.restore)
      return undefined
    }

    // expect(a).not.toBe(b), expect(p).rejects.toThrow(E)
    let not = false
    let promise: 'resolves' | 'rejects' | undefined
    let base = object
    for (;;) {
      const flag = base.type === 'MemberExpression' ? nameOf(base.property as Node) : undefined
      if (flag === 'not') not = true
      else if (flag === 'resolves' || flag === 'rejects') promise = flag
      else break
      base = base.object as Node
    }
    // expect.soft(value), expect.poll(fn) of Playwright
    const from = base.type === 'CallExpression' ? (base.callee as Node) : undefined
    const form =
      framework === 'playwright' && from?.type === 'MemberExpression' && roleOf(from.object as Node) === 'expect'
        ? nameOf(from.property as Node)
        : undefined
    if (form === 'poll') {
      const [fn, more] = base.arguments as Node[]
      const want = args[0]
      const value = want?.type === 'Literal' || want?.type === 'TemplateLiteral'
      // A pattern of assert.eventually that is an object is partial,
      // so only a plain value has the same check.
      if (
        not ||
        promise ||
        !fn ||
        more ||
        args.length !== 1 ||
        !value ||
        !/^(toBe|toEqual|toStrictEqual)$/.test(method)
      ) {
        todo(path, TODO.eventually)
        return [...(base.arguments as Node[]), ...args]
      }
      replace(node.start, fn.start, 'assert.eventually(')
      replace(fn.end, want!.start, ', ')
      replace(want!.end, node.end, ')')
      used.add('assert')
      changes++
      awaited(node, path)
      return [fn, want!]
    }
    if (base.type !== 'CallExpression' || (roleOf(from) !== 'expect' && form !== 'soft')) return undefined
    const subject = (base.arguments as Node[])[0]
    if (!subject) {
      todo(path, 'expect() has no value. Write an assertion with assert.')
      return undefined
    }
    const all = [subject, ...args]
    const fail = (): undefined => {
      todo(
        path,
        method === 'toThrow' && not && !promise
          ? TODO.notThrow
          : method === 'toMatchInlineSnapshot'
            ? TODO.inline
            : method === 'toHaveProperty'
              ? TODO.path
              : framework === 'playwright' && (!(method in MATCHERS) || method === 'toHaveClass')
                ? TODO.eventually
                : `ubq has no ${not ? 'not.' : ''}${promise ? promise + '.' : ''}${method}. Write an assertion with assert, assert.equal, assert.deepEqual, or assert.match.`,
      )
      return undefined
    }
    // await expect(locator).toHaveText('x') of Playwright waits for
    // the value: assert.eventually reads it again and again.
    const web = framework === 'playwright' ? WEB_FIRST[method] : undefined
    if (web) {
      const [read, expected] = web
      const want = expected === true ? undefined : args[expected]
      // An argument after the expected value has options, such as a
      // time limit.
      const options = args[expected === true ? 0 : expected + 1]
      const literal = want?.type === 'Literal' && typeof want.value === 'string'
      if (
        promise ||
        options ||
        (expected !== true && (!want || not)) ||
        // Playwright reads a path from the base URL.
        (method === 'toHaveURL' && literal && !/^\w+:/.test(want!.value as string)) ||
        (method === 'toContainText' && !literal)
      ) {
        todo(path, TODO.eventually)
        return undefined
      }
      const wrap = !SIMPLE.has(subject.type)
      const close = wrap ? ')' : ''
      replace(node.start, subject.start, `assert.eventually(() => ${wrap ? '(' : ''}`)
      if (!want) replace(subject.end, node.end, `${close}.${read}, ${!not})`)
      else if (expected === 1) {
        replace(subject.end, args[0]!.start, `${close}.getAttribute(`)
        replace(args[0]!.end, want.start, '), ')
        replace(want.end, node.end, ')')
      } else {
        const list = method === 'toHaveText' && want.type === 'ArrayExpression'
        replace(subject.end, want.start, `${close}.${list ? 'allTextContents()' : read}, `)
        // The text is a part of the text of the element.
        if (method === 'toContainText') messageRegExp(want)
        replace(want.end, node.end, ')')
      }
      used.add('assert')
      changes++
      awaited(node, path)
      return [subject, ...args.slice(0, expected === true ? 0 : expected + 1)]
    }
    // expect(list).toEqual(expect.arrayContaining(['a', 'b'])) is one
    // assert.contains for each element. The list must give the same
    // value each time that the code reads it.
    const contained = args[0]
    const sample = (contained?.arguments as Node[] | undefined)?.[0]
    if (
      (method === 'toEqual' || method === 'toStrictEqual') &&
      !not &&
      !promise &&
      args.length === 1 &&
      contained!.type === 'CallExpression' &&
      (contained!.callee as Node).type === 'MemberExpression' &&
      roleOf((contained!.callee as Node).object as Node) === 'expect' &&
      nameOf((contained!.callee as Node).property as Node) === 'arrayContaining' &&
      sample?.type === 'ArrayExpression' &&
      (sample.elements as (Node | null)[]).length &&
      (sample.elements as (Node | null)[]).every(e => e?.type === 'Literal' && !(e as { regex?: unknown }).regex) &&
      plainPath(subject) &&
      (statementOf(path) as { expression?: Node }).expression === node
    ) {
      changes++
      used.add('assert')
      replace(
        node.start,
        node.end,
        (sample.elements as Node[])
          .map(e => `assert.contains(${text(subject)}, ${text(e)})`)
          .join(`\n${indentAt(node.start)}`),
      )
      return []
    }
    // expect(a).toEqual(expect.objectContaining({ id: 1 })) is a pattern.
    if (
      (method === 'toEqual' || method === 'toStrictEqual') &&
      !promise &&
      args.length === 1 &&
      patternArgs(node, args)
    )
      return rewrite(node, not ? 'assert(!isMatch($0, $1))' : 'assert.match($0, $1)', all)
    // isDeepEqual does not know a matcher of expect.
    if (method === 'toContainEqual' && args.some(arg => /\bexpect\./.test(text(arg)))) {
      todo(path, TODO.matcher)
      return undefined
    }
    if (method === 'toHaveTextContent' && args.length === 1 && !promise) {
      // The text of an element has the text in it, or matches.
      const [value] = args
      if (value!.type !== 'Literal') return fail()
      const regex = (value as { regex?: unknown }).regex
      return rewrite(
        node,
        regex
          ? not
            ? 'assert(!<$0>.textContent?.match($1))'
            : 'assert.match(<$0>.textContent, $1)'
          : `assert.${not ? 'notContains' : 'contains'}(<$0>.textContent, $1)`,
        all,
      )
    }
    // In a test of Playwright, the check waits for the class.
    if (
      method === 'toHaveClass' &&
      (framework === 'playwright' || !/^(['"])[\w-]+\1$/.test(args.length === 1 ? text(args[0]!) : ''))
    )
      return fail()
    // A getBy query gives an element or throws: it has no null.
    if (method === 'toBeInTheDocument' && !args.length && !promise && /\b(get|getAll)By\w+\(/.test(text(subject)))
      return rewrite(node, not ? 'assert(!<$0>.isConnected)' : 'assert(<$0>.isConnected)', all)
    if (method === 'toMatch' && args[0]) {
      // A value can be text or a RegExp, and the two have different forms.
      if (args[0].type !== 'Literal' && args[0].type !== 'TemplateLiteral') {
        todo(
          path,
          'toMatch takes text or a RegExp. For a RegExp: assert.match(value, pattern). For text: assert.contains(value, text).',
        )
        return undefined
      }
      const regex = args[0].type === 'Literal' && (args[0] as { regex?: unknown }).regex
      // The arguments of a rule keep their order, so not `re.test(a)`.
      return rewrite(
        node,
        regex
          ? not
            ? 'assert(!<$0>.match($1))'
            : 'assert.match($0, $1)'
          : `assert.${not ? 'notContains' : 'contains'}($0, $1)`,
        all,
      )
    }
    if (/^toHaveBeen|^toBeCalled/.test(method)) {
      const real = realImport(subject)
      if (real) todo(path, real)
    }
    if (method === 'toHaveBeenNthCalledWith' && !not && !promise) {
      const n = args[0]
      if (n?.type !== 'Literal' || typeof n.value !== 'number' || !Number.isInteger(n.value) || n.value < 1)
        return fail()
      changes++
      used.add('assert')
      replace(node.start, subject.start, patternArgs(node, args.slice(1)) ? 'assert.match(' : 'assert.deepEqual(')
      if (args.length === 1) replace(subject.end, node.end, `.calls[${n.value - 1}]?.args, [])`)
      else {
        replace(subject.end, args[1]!.start, `.calls[${n.value - 1}]?.args, [`)
        replace(args.at(-1)!.end, node.end, '])')
      }
      return [subject, ...args.slice(1)]
    }
    if (
      method === 'toHaveBeenCalledExactlyOnceWith' &&
      !not &&
      !promise &&
      plainPath(subject) &&
      path.at(-2)?.type === 'ExpressionStatement'
    ) {
      changes++
      used.add('assert')
      const head = `assert.equal(${text(subject)}.calls.length, 1)\n${indentAt(node.start)}assert.${patternArgs(node, args) ? 'match' : 'deepEqual'}(`
      replace(node.start, subject.start, head)
      if (!args.length) replace(subject.end, node.end, '.calls[0]?.args, [])')
      else {
        replace(subject.end, args[0]!.start, '.calls[0]?.args, [')
        replace(args.at(-1)!.end, node.end, '])')
      }
      return all
    }
    if (method === 'toHaveBeenCalledWith' && !promise) {
      // jest and vitest pass if any call had the arguments.
      const name = ['call', 'entry', 'one'].find(n => !all.some(arg => mentions(arg, n))) ?? '_call'
      const wrap = !SIMPLE.has(subject.type)
      // With a matcher of expect, the arguments are a pattern.
      const compare = patternArgs(node, args) ? 'isMatch' : 'isDeepEqual'
      const head = `${wrap ? ')' : ''}.calls.some(${name} => ${compare}(${name}.args, [`
      changes++
      used.add('assert').add(compare)
      replace(node.start, subject.start, (not ? 'assert(!' : 'assert(') + (wrap ? '(' : ''))
      if (!args.length) replace(subject.end, node.end, `${head}])))`)
      else {
        replace(subject.end, args[0]!.start, head)
        replace(args.at(-1)!.end, node.end, '])))')
      }
      return all
    }
    if (method === 'toHaveBeenLastCalledWith' && !not && !promise) {
      // The arguments of the last call.
      changes++
      used.add('assert')
      replace(node.start, subject.start, patternArgs(node, args) ? 'assert.match(' : 'assert.deepEqual(')
      if (!args.length) replace(subject.end, node.end, '.calls.at(-1)?.args, [])')
      else {
        replace(subject.end, args[0]!.start, '.calls.at(-1)?.args, [')
        replace(args.at(-1)!.end, node.end, '])')
      }
      return all
    }
    if (promise === 'rejects' && /^toThrow(Error)?$/.test(method) && !not) {
      expectedError(args[0], path)
      awaited(node, path)
      return rewrite(node, args.length ? 'assert.rejects($0, $1)' : 'assert.rejects($0, Error)', all)
    }
    if (promise === 'rejects') {
      // The promise has no value to await: `await` throws its error.
      if (!not && (method === 'toBeInstanceOf' || method === 'toMatchObject') && args.length === 1) {
        awaited(node, path)
        return rewrite(node, 'assert.rejects($0, $1)', all)
      }
      todo(path, TODO.rejects)
      return undefined
    }
    // A name with a path ('a.b') is not one key.
    if (method === 'toHaveProperty' && !/^(['"])[\w$-]+\1$/.test(args[0] ? text(args[0]) : '')) return fail()
    let rule = pick((not ? NOT_MATCHERS[method] : undefined) ?? MATCHERS[method] ?? '$9', all.length)
    if (!rule || rule === '$9') return fail()
    if (not && !NOT_MATCHERS[method]) {
      // assert(x) becomes assert(!(x)). A different form has no opposite.
      const m = /^assert\((.*)\)$/.exec(rule)
      if (!m || rule.startsWith('assert(!')) return fail()
      rule = `assert(!(${m[1]}))`
    }
    if (promise) {
      rule = rule.replace(/<\$0>|\$0/, m => (m === '$0' ? 'await $0' : '(await $0)'))
      asyncFunction(path)
      // `await expect(p).resolves.toBe(1)`: the new call gives no promise.
      const outer = path.at(-2)
      if (outer?.type === 'AwaitExpression') replace(outer.start, node.start, '')
    }
    if (/^toThrow(Error)?$/.test(method)) {
      expectedError(args[0], path)
    }
    // `expect(a?.b).toHaveLength(2)` took a value that is undefined.
    // `a?.b.length` is a type error if `b` can be undefined too.
    if (!not && !promise && subject.type === 'ChainExpression') rule = rule.replace('<$0>.', '<$0>?.')
    return rewrite(node, rule, all)
  }

  const assertCall = (node: Node, path: Node[], method: string): Node[] | undefined => {
    const args = node.arguments as Node[]
    const rule = ASSERT[method] && pick(ASSERT[method], args.length)
    if (!rule) {
      todo(
        path,
        `ubq has no assert.${method}. Write an assertion with assert, assert.equal, assert.deepEqual, assert.match, or assert.throws.`,
      )
      return undefined
    }
    if (method === 'rejects') awaited(node, path)
    const count = rule.match(/\$\d/g)?.length ?? 0
    // A message is the argument after the last one of the rule.
    const use = method === 'fail' ? rule : withMessage(rule, count, args)
    if (method === 'fail' && inLoop(path)) todo(path, TODO.failLoop)
    if (!path.some(n => FUNCTION.has(n.type))) rootAssert(path)
    return rewrite(node, use, args)
  }

  const tapCall = (node: Node, path: Node[], method: string): Node[] | undefined => {
    const args = node.arguments as Node[]
    const callee = node.callee as Node
    /** True if the call is in the function of a test. */
    const inTest = path.some(n => FUNCTION.has(n.type))
    if (method === 'test') {
      definition(node, path, 'test', true)
      return args
    }
    if (method === 'end' || method === 'plan' || method === 'endAll') {
      // The function of the call, and the call that the function is
      // an argument of.
      const at = path.findLastIndex(n => FUNCTION.has(n.type))
      const fn = path[at]
      const owner = at > 0 ? path[at - 1]! : undefined
      const callee = owner?.type === 'CallExpression' ? (owner.callee as Node) : undefined
      const root = callee?.type === 'MemberExpression' ? (callee.object as Node) : callee
      const ofTest =
        !fn ||
        roleOf(root) === 'test' ||
        roleOf(root) === 'tap' ||
        (root?.type === 'MemberExpression' && roleOf(root.object as Node) === 'test')
      const param = fn && nameOf((fn.params as Node[])[0])
      /** True if a function in the test function uses the test object. */
      const inner = (n: Node, top = true): boolean =>
        (!top && FUNCTION.has(n.type) && !!param && mentions(n, param)) ||
        children(n).some(c => !(n.type === 'CallExpression' && SYNC.test(text(n.callee as Node))) && inner(c, false))
      const end = endCalls.get(node)
      if (end) {
        replace(node.start, node.end, `${end}()`)
        changes++
        return []
      }
      if (method !== 'plan' && !ofTest) {
        todo(path, TODO.end)
        return []
      }
      // t.plan(0, 'not on Windows'): tap skips the file.
      if (method === 'plan' && args.length > 1 && args[0]!.value === 0) {
        todo(path, TODO.planSkip)
        return undefined
      }
      // tap and tape: a test with a plan ends after that count of
      // assertions, also if its function ended before.
      if (method === 'plan' && framework !== 'ava' && fn && !fn.async && !promised.has(fn) && inner(fn))
        todo(path, TODO.plan)
      else if (!removeStatement(path)) todo(path, `ubq has no t.${method}. A test ends when its function ends.`)
      return []
    }
    if (method === 'timeout' || method === 'timeoutAfter') {
      todo(path, TODO.testTimeout)
      return undefined
    }
    if (/^(notThrows|notThrowsAsync|doesNotThrow)$/.test(method)) {
      // t.notThrows(() => f(x)) becomes f(x)
      const [fn] = args
      const body = fn?.body as Node | undefined
      const code =
        fn?.type === 'ArrowFunctionExpression' && !(fn.params as Node[]).length
          ? body!.type !== 'BlockStatement' && body!.type !== 'ObjectExpression'
            ? body
            : undefined
          : method === 'notThrowsAsync' && fn && !FUNCTION.has(fn.type)
            ? fn
            : undefined
      const parent = path.at(-2)
      const statement = parent?.type === 'AwaitExpression' ? path.at(-3) : parent
      if (!code || args.length > 2 || statement?.type !== 'ExpressionStatement') {
        todo(path, TODO.notThrows)
        return undefined
      }
      replace(node.start, code.start, method === 'notThrowsAsync' && parent === statement ? 'await ' : '')
      replace(code.end, node.end, '')
      if (method === 'notThrowsAsync') asyncFunction(path)
      messageComment(node, args[1], path)
      changes++
      return [code]
    }
    if (framework === 'ava' && (method === 'throws' || method === 'throwsAsync')) {
      const [fn, expected, message] = args
      const name = method === 'throws' ? 'assert.throws' : 'assert.rejects'
      const props = expected?.type === 'ObjectExpression' ? (expected.properties as Node[]) : undefined
      const keys = props?.map(p => (p.type === 'Property' && !p.computed ? nameOf(p.key as Node) : undefined))
      // { instanceOf: TypeError } is the class. An object with no
      // class is a pattern.
      const only = keys?.length === 1 && keys[0] === 'instanceOf' ? (props![0]!.value as Node) : undefined
      const pattern = keys?.every(key => key && key !== 'instanceOf' && key !== 'is')
      if (!fn || (expected && !only && !pattern && nameOf(expected) !== 'undefined')) {
        todo(path, TODO.avaThrows)
        return undefined
      }
      messageComment(node, message, path)
      if (method === 'throwsAsync') awaited(node, path)
      return only
        ? rewrite(node, `${name}($0, $1)`, [fn, only])
        : rewrite(node, pattern ? `${name}($0, $1)` : `${name}($0, Error)`, args)
    }
    if (method === 'comment' || (framework === 'ava' && method === 'log')) {
      replace(callee.start, callee.end, 'console.log')
      changes++
      return args
    }
    if (/^(beforeEach|afterEach|before)$/.test(method)) {
      todo(path, TODO.hook)
      return undefined
    }
    if (method === 'mockImport' || method === 'mockRequire' || method === 'mock') {
      const [spec, mocks] = args
      const entries = mocks?.type === 'ObjectExpression' ? (mocks.properties as Node[]) : undefined
      const plain = entries?.every(
        p => p.type === 'Property' && !p.computed && !p.shorthand && (p.key as Node).type === 'Literal',
      )
      if (method !== 'mockImport' || spec?.type !== 'Literal' || (mocks && !plain)) {
        todo(path, TODO.mock)
        return undefined
      }
      // t.mockImport('../a.js', { '../b.js': { f } })
      changes++
      used.add('mockImport')
      replace(node.start, spec.start, 'mockImport(() => import(')
      if (!entries?.length) {
        replace(spec.end, node.end, '), [])')
        return []
      }
      let last = spec.end
      const kept: Node[] = []
      entries.forEach((p, i) => {
        const key = p.key as Node
        const value = p.value as Node
        replace(last, key.start, i ? '], [() => import(' : '), [[() => import(')
        replace(key.end, value.start, '), ')
        last = value.end
        kept.push(value)
      })
      replace(last, node.end, ']])')
      return kept
    }
    if (method === 'type' && args.length >= 2) {
      const typeName = args[1]!.type === 'Literal' && typeof args[1]!.value === 'string'
      return rewrite(node, typeName ? 'assert.equal(typeof $0, $1)' : 'assert(<$0> instanceof $1)', args)
    }
    if (method === 'resolves') {
      todo(path, TODO.resolves)
      return undefined
    }
    const table = framework === 'ava' ? AVA : framework === 'tape' ? TAPE : TAP
    // t.equal(a, b, 'message', { todo: 'reason' })
    const extra = args.at(-1)
    if (
      extra?.type === 'ObjectExpression' &&
      (extra.properties as Node[]).some(
        p => /^(skip|todo)$/.test(String(nameOf(p.key as Node))) && (p.value as Node | undefined)?.value !== false,
      )
    )
      todo(path, TODO.assertOption)
    const rule = table[method] && pick(table[method], args.length)
    if (!rule) {
      todo(
        path,
        method === 'fixture'
          ? 'ubq has no form of t.fixture. testdir() makes files and folders. For a symbolic link, call symlinkSync of node:fs after testdir().'
          : `ubq has no form of t.${method}. See: ubq guide convert.`,
      )
      return undefined
    }
    // An Error instance as the expected error is not a form of ubq.
    if (/^(throws|throw|rejects)$/.test(method) && /^(Identifier|NewExpression)$/.test(String(args[1]?.type)))
      expectedError(args[1], path)
    // tap: t.throws(fn, 'message') has a message, and no expected error.
    const count = rule.match(/\$\d/g)?.length ?? 0
    let use = rule
    if (/^(throws|throw|rejects)$/.test(method) && args[1]?.type === 'Literal' && typeof args[1].value === 'string') {
      use = withMessage(pick(table[method]!, 1)!, 1, args)
    } else if (!/^(fail|teardown|after|testdir)$/.test(method)) use = withMessage(use, count, args)
    if (method === 'fail' && inLoop(path)) todo(path, TODO.failLoop)
    if (method === 'rejects' || method.startsWith('resolveMatch')) awaited(node, path)
    if (!inTest && use.startsWith('assert')) rootAssert(path)
    return rewrite(node, use, args)
  }

  planSetups()
  const first = (program.body as Node[])[0]
  // `@jest-environment node` is the environment of ubq.
  const docblock =
    /\/\*[\s*]*@(?:vitest|jest)-environment\s+node[\s*]*\*\/[ \t]*\r?\n?/.exec(source) ??
    /^[ \t]*\/\/\s*@(?:vitest|jest)-environment\s+node[ \t]*\r?\n?/m.exec(source)
  const imports = (module: RegExp): boolean =>
    (program.body as Node[]).some(
      node => node.type === 'ImportDeclaration' && module.test(String((node.source as { value?: unknown }).value)),
    )
  // A file that asks for a DOM, or that uses a library that needs
  // one. A file with the node environment that imports jsdom makes
  // its own DOM.
  const dom =
    /@(vitest|jest)-environment\s+(jsdom|happy-dom)\b/.test(source) ||
    imports(/^@testing-library\//) ||
    (!docblock && imports(/^(jsdom|happy-dom)$/))
  if (first && dom) todo([program, first], TODO.dom)
  if (docblock) {
    replace(docblock.index, docblock.index + docblock[0].length, '')
    changes++
  }
  // process.env.NAME = value, before an import of the file.
  const lastImport = (program.body as Node[]).findLast(node => node.type === 'ImportDeclaration')
  if (esm && lastImport)
    for (const node of program.body as Node[])
      if (
        node.start < lastImport.start &&
        node.type === 'ExpressionStatement' &&
        /^process\.env\b[^=]*=[^=]/.test(text(node))
      )
        todo([program, node], TODO.envFirst)
  walk(program, [])

  // --- The import of ubqtest, in place of the old imports ---
  const names = [...used].sort().join(', ')
  // The new line has the form of the line that it replaces, or of
  // the first import of the file: a `;`, and the quotes.
  const like = removed[0] ?? (program.body as Node[]).find(node => node.type === 'ImportDeclaration')
  const semi = like && text(like).endsWith(';') ? ';' : ''
  const quote = like && /"[^'"]*"\)?;?$/.test(text(like)) ? '"' : "'"
  const line = names
    ? (commonJs ? `const { ${names} } = require('ubqtest')` : `import { ${names} } from 'ubqtest'`).replaceAll(
        "'",
        quote,
      ) + semi
    : ''
  // The page of a test, and the names of the Playwright library
  // that the file had from `@playwright/test`.
  const more = [
    usesBrowser &&
      (commonJs ? "const { browser } = require('ubqtest/browser')" : "import { browser } from 'ubqtest/browser'"),
    libraryTypes.length && `import type { ${libraryTypes.join(', ')} } from 'playwright-core'`,
    libraryValues.length && `import { ${libraryValues.join(', ')} } from 'playwright-core'`,
  ]
    .filter(text => typeof text === 'string')
    .map(text => `\n${text.replaceAll("'", quote)}${semi}`)
    .join('')
  /** `;` if code is after a statement on its line: the new text must not join that code. */
  const before = (node: Node): string => {
    const end = source.indexOf('\n', node.end)
    return source.slice(node.end, end < 0 ? source.length : end).trim() ? ';' : ''
  }
  removed.forEach((node, i) => {
    const join = before(node)
    if (i === 0 && line) replace(node.start, node.end, line + more + (semi ? '' : join))
    else replace(node.start, source[node.end] === '\n' ? node.end + 1 : node.end, '')
  })
  if (!removed.length && line) {
    // After a `#!` line.
    const at = source.startsWith('#!') ? source.indexOf('\n') + 1 : 0
    edits.push({ start: at, end: at, text: line + '\n' })
  }
  const [workersImport, ...moreWorkers] = workersImports
  // One file can have two imports of the module. The first one gets
  // the new lines.
  for (const node of moreWorkers) replace(node.start, source[node.end] === '\n' ? node.end + 1 : node.end, '')
  if (workersImport) {
    const lines: string[] = []
    if (workersKept.length) lines.push(`import { ${workersKept.join(', ')} } from 'cloudflare:workers'`)
    if (workersUsed.size) lines.push(`import { ${[...workersUsed].sort().join(', ')} } from 'ubqtest/workers'`)
    if (workersLeft.length) {
      lines.push(`import { ${workersLeft.join(', ')} } from 'cloudflare:test'`)
      todos.set(workersImport.start, (todos.get(workersImport.start) ?? new Set()).add(TODO.workers))
    }
    replace(workersImport.start, workersImport.end, lines.join('\n') + before(workersImport))
    changes++
  }
  if (shifts.length) {
    // The text of a template literal is a value: it does not move.
    const templates: Node[] = []
    const find = (n: Node): void => {
      if (n.type === 'TemplateLiteral') templates.push(n)
      else for (const child of children(n)) find(child)
    }
    find(program)
    const space = /[ \t]*/y
    for (const { start, end, by } of shifts)
      for (let at = source.indexOf('\n', start) + 1; at > 0 && at < end; at = source.indexOf('\n', at) + 1) {
        space.lastIndex = at
        const lead = space.exec(source)![0].length
        const cut = Math.min(-by, lead)
        if (
          /^[\r\n]?$/.test(source.charAt(at + lead)) ||
          templates.some(t => t.start < at && at < t.end) ||
          edits.some(e => e.start < at + Math.max(cut, 1) && e.end > at)
        )
          continue
        edits.push(by < 0 ? { start: at, end: at + cut, text: '' } : { start: at, end: at, text: ' '.repeat(by) })
      }
  }
  // The first TODO of a file with a text has the full text. Each
  // later one has its first sentence: a file can have the same
  // text 25 times.
  const full = new Map<string, string>()
  for (const [at, messages] of [...todos].sort((a, b) => a[0] - b[0])) {
    const from = lineStart(at)
    const indent = /^\s*/.exec(source.slice(from, at))![0]
    const comment = (message: string): string => {
      // ubq: not measured: each TODO text has a full stop
      const short = `${/^.*?[.:](?=\s|$)/.exec(message)?.[0] ?? message} ${AS_ABOVE}`
      // Two texts can have the same first sentence. Only the text
      // that the sentence is for has the short form.
      if (short.length < message.length && full.get(short) === message) return todoComment(indent, short)
      if (!full.has(short)) full.set(short, message)
      return todoComment(indent, message)
    }
    edits.push({ start: from, end: from, text: [...messages].map(comment).join('') })
  }

  // Text that is put in comes before a change at the same place.
  edits.sort((a, b) => a.start - b.start || a.end - b.end)
  let code = ''
  let at = 0
  for (const edit of edits) {
    if (edit.start < at)
      // ubq: not measured: no known input makes two changes overlap
      throw new Error(
        `the command cannot change line ${source.slice(0, edit.start).split('\n').length}. Write that statement in a different form, or convert this file by hand.`,
      )
    code += source.slice(at, edit.start) + edit.text
    at = edit.end
  }
  code += source.slice(at)
  // The setup file of the vitest config applied the migrations of
  // D1 for each test file. In ubq, the test file does that.
  // Not in a CommonJS file: it has no `await` at its top level.
  const lines = commonJs
    ? []
    : migrate.filter(binding => !code.includes(`migrate('${binding}')`)).map(binding => `await migrate('${binding}')`)
  if (lines.length) {
    const imports = (parse(code, file).body as Node[]).filter(n => n.type === 'ImportDeclaration')
    const helpers = imports.find(n => (n.source as { value?: unknown }).value === 'ubqtest/workers')
    // After the line of the last import. The file has one: that of ubqtest.
    const lineEnd = code.indexOf('\n', imports.at(-1)!.end)
    // ubq: not measured: a test file has code after its last import
    const at = lineEnd < 0 ? code.length : lineEnd
    const added = `${helpers ? '' : "\nimport { migrate } from 'ubqtest/workers'"}\n\n${lines.join('\n')}`
    code = code.slice(0, at) + added + code.slice(at)
    if (helpers && !/\bmigrate\b/.test(code.slice(helpers.start, helpers.end)))
      code =
        code.slice(0, helpers.start) +
        code.slice(helpers.start, helpers.end).replace(
          /\{([^}]*)\}/,
          (_, names: string) =>
            `{ ${[
              ...names
                .split(',')
                .map(name => name.trim())
                .filter(Boolean),
              'migrate',
            ]
              .sort()
              .join(', ')} }`,
        ) +
        code.slice(helpers.end)
    changes++
  }
  // The new text must be code.
  try {
    parse(code, file)
  } catch (error) {
    // ubq: not measured: no known input makes text that is not code
    const { message } = error as Error
    // The place is in the new text, not in the file.
    const line = code.split('\n')[+(/\((\d+):\d+\)$/.exec(message)?.[1] ?? 0) - 1]
    throw new Error(
      `the command made text that is not code (${message.replace(/ \(\d+:\d+\)$/, '')}) from the statement that became: ${line?.trim()}. The file did not change. Convert this file by hand.`,
    )
  }
  const found: Converted['todos'] = []
  const all = code.split('\n')
  all.forEach((text, i) => {
    const m = /\/\/ TODO\(ubq\): (.*)$/.exec(text) ?? /'TODO\(ubq\): (the reason)'/.exec(text)
    if (!m || !text.trim().startsWith('//')) return
    // The next lines of a comment that todoComment wrapped.
    let message = m[1]!
    for (let j = i + 1; j < all.length; j++) {
      const more = /^\s*\/\/ (?!TODO\(ubq\))(.*)$/.exec(all[j]!)
      if (!more) break
      message += ` ${more[1]}`
    }
    // The report has the full text of each TODO.
    found.push({ line: i + 1, text: full.get(message) ?? message })
  })
  return { code, framework, changes: changes + removed.length, todos: found }
}

/** A file that can have code. Not a declaration file. */
const CODE = /(?<!\.d)\.([cm]?[jt]s|[jt]sx)$/
/** The default name of a test file. */
const TEST_NAME = /\.test\.([cm]?[jt]s|[jt]sx)$/
/** The program that formats files, for each formatter package. */
const FORMATTERS: [pkg: string, bin: string, ...args: string[]][] = [
  ['prettier', 'prettier', '--write'],
  ['oxfmt', 'oxfmt'],
  ['@biomejs/biome', 'biome', 'format', '--write'],
  ['dprint', 'dprint', 'fmt'],
]

/**
 * Formats the files with the formatter of the project, or of a
 * project around it (a workspace). Returns the text of a note.
 */
const formatFiles = (root: string, files: string[]): string | undefined => {
  for (let dir = root; ; dir = dirname(dir)) {
    let pkg: Record<string, Record<string, string> | undefined> = {}
    try {
      pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    } catch {
      // No package.json that is JSON in this folder.
    }
    const found = FORMATTERS.find(([name]) => pkg.devDependencies?.[name] ?? pkg.dependencies?.[name])
    if (found) {
      const [, bin, ...args] = found
      const byHand = `To format the changed files: npx ${[bin, ...args, ...files].join(' ')}`
      const windows = process.platform === 'win32'
      // ubq: not measured: the tests of one run are on one system
      const program = join(dir, 'node_modules/.bin', windows ? `${bin}.cmd` : bin)
      if (!existsSync(program)) return `this command did not format the code: ${bin} is not installed. ${byHand}`
      // A command line has a limit of length.
      for (let i = 0; i < files.length; i += 50) {
        const run = spawnSync(program, [...args, ...files.slice(i, i + 50)], {
          cwd: root,
          encoding: 'utf8',
          shell: windows,
        })
        if (run.status !== 0) {
          const why = (run.error?.message ?? run.stderr).trim().split('\n')[0] || `exit code ${run.status}`
          return `this command did not format the code: ${bin} failed (${why}). ${byHand}`
        }
      }
      return `formatted the changed files with ${bin}.`
    }
    if (dirname(dir) === dir) return undefined
  }
}

/**
 * A comment of an other coverage tool that leaves out code. The
 * `stop` comment of a range is not a place: its `start` comment is.
 */
const IGNORE = /\/[*/]\s*(c8|istanbul|v8)\s+ignore\b(?!\s+stop)/

/** A file of types. */
const TYPES = /\.d\.[cm]?ts$/

/** `ubq convert <files or folders>`. Prints the report with `out`. Returns the exit code. */
export const convertCommand = (args: string[], out: (text: string) => void): number => {
  const compiler = args.find(a => a.startsWith('--transform'))
  if (compiler !== undefined) return setupTransform(compiler.slice('--transform='.length), out)
  const dry = args.includes('--dry')
  const paths = args.filter(a => a !== '--dry')
  if (!paths.length || paths.some(p => p.startsWith('--')))
    throw new UsageError(
      'ubq convert needs test files or folders, such as: ubq convert test. With --dry, it changes no file.',
    )
  const { parse, children } = createRequire(import.meta.url)(INSTRUMENT) as typeof import('./instrument.ts')
  const files: string[] = []
  /** Files of types, such as `env.d.ts`, in the folders. */
  const types: string[] = []
  for (const path of paths) {
    const full = resolve(path)
    let folder: boolean
    try {
      folder = statSync(full).isDirectory()
    } catch {
      throw new UsageError(`no such file or folder: ${path}`)
    }
    if (!folder) files.push(full)
    else
      for (const name of readdirSync(full, { recursive: true }) as string[])
        if (/(^|[\\/])(node_modules|\.[^\\/]+)[\\/]/.test(name)) continue
        else if (CODE.test(name)) files.push(join(full, name))
        else if (TYPES.test(name)) types.push(join(full, name))
  }
  // A project of the vitest plugin for Workers: its vitest config
  // has what the `workers` key of the ubq configuration needs.
  const root = projectRoot()
  const vitest = vitestWorkers(root, parse, children)
  /** For each test file of a Workers project: the D1 bindings that its setup file migrated. */
  const migrations = new Map<string, string[]>()
  /** Setup files that only applied migrations. */
  const spent: string[] = []
  const setupNotes: string[] = []
  for (const project of vitest?.projects ?? []) {
    const bindings: string[] = []
    for (const setup of project.setupFiles) {
      let found: ReturnType<typeof setupMigrations>
      try {
        found = setupMigrations(readFileSync(join(root, setup), 'utf8'))
      } catch {
        continue
      }
      bindings.push(...found.bindings)
      if (found.only) spent.push(setup)
      else
        setupNotes.push(
          `note: ${setup} is a setup file of ${vitest!.file}. ubq has no setup files. Export its work as a function, and await that function at the top level of each test file. See "A Cloudflare Worker" in: ubq guide convert`,
        )
    }
    if (bindings.length)
      for (const found of globSync(project.entry.include, { cwd: root })) {
        const path = join(root, found)
        if (!migrations.has(path)) migrations.set(path, bindings)
      }
  }
  const sources = new Map(files.map(path => [path, readFileSync(path, 'utf8')]))
  const drop = restorePlan(sources, parse, children)
  let changed = 0
  let todos = 0
  /** Files that use no test tool that this command knows. */
  const unknown: string[] = []
  /** The text of each hint of the report, in the order of its first place. */
  const hints: string[] = []
  let failed = 0
  const unnamed: string[] = []
  let workers = 0
  /** True if a file had tests of Playwright Test. */
  let playwright = false
  const written: string[] = []
  /** Files that still name a test tool that the project removes. */
  const old: string[] = []
  for (const path of files.sort()) {
    const file = rel(path)
    let result: Converted | undefined
    try {
      result = convertSource(sources.get(path)!, path, parse, children, migrations.get(path), drop.get(path))
    } catch (error) {
      out(`not converted ${file}: ${(error as Error).message}`)
      failed++
      continue
    }
    if (!result) {
      unknown.push(file)
      continue
    }
    if (OLD_TOOL.test(result.code)) old.push(file)
    if (result.framework === 'playwright') playwright = true
    changed++
    todos += result.todos.length
    written.push(file)
    if (!dry) writeFileSync(path, result.code)
    // A file with no tests is a helper. Its name is not a problem.
    if (
      !TEST_NAME.test(file) &&
      (/^\s*(test|describe)\(/m.test(result.code) || result.todos.some(t => t.text === TODO.rootAssert))
    )
      unnamed.push(file)
    if (/from\s+['"](cloudflare:|ubqtest\/workers)/.test(result.code)) workers++
    out(
      counted`${dry ? 'to convert' : 'converted'} ${file} (${result.framework}): ${result.changes} change|changes, ${result.todos.length} TODO`,
    )
    // The text of a hint is long, and many places have the same
    // one. A place has the number of its hint and the first
    // sentence. The full text of each hint is below the files.
    for (const t of result.todos) {
      if (!hints.includes(t.text)) hints.push(t.text)
      // ubq: not measured: each TODO text has a full stop
      out(`  ${file}:${t.line}  [${hints.indexOf(t.text) + 1}] ${/^.*?[.:](?=\s|$)/.exec(t.text)?.[0] ?? t.text}`)
    }
  }
  if (hints.length) out('hints:')
  hints.forEach((text, i) => out(`  [${i + 1}] ${text}`))
  const parts = [
    counted`${changed} file|files ${dry ? 'to change' : 'changed'}`,
    counted`${todos} TODO comment|comments`,
  ]
  if (failed) parts.push(counted`${failed} file|files not converted (see the lines above)`)
  if (unknown.length) {
    const more = unknown.length > 10 ? `, and ${unknown.length - 10} more` : ''
    parts.push(
      counted`${unknown.length} file|files with no known test tool (${unknown.slice(0, 10).join(', ')}${more})`,
    )
  }
  out(`convert: ${parts.join(', ')}`)
  if (unnamed.length && !config().include) {
    const folders = [...new Set(unnamed.map(f => f.split('/')[0]!))]
    // The end that the names share, such as `.spec.ts`. A glob for
    // each file of the folder would make each source file a test file.
    const end = (file: string): string => /(\.[\w-]+)?\.[cm]?[jt]sx?$/.exec(file)![0]
    const globs = folders.flatMap(f =>
      unnamed.includes(f)
        ? [f]
        : [...new Set(unnamed.filter(u => u.startsWith(`${f}/`)).map(end))].sort().map(e => `${f}/**/*${e}`),
    )
    out(
      counted`note: ${unnamed.length} of these files has|have tests, and does|do not have a name that ubq runs (*.test.ts): ${unnamed.slice(0, 5).join(', ')}${unnamed.length > 5 ? ', ...' : ''}. Rename them, or add to package.json: "ubq": { "include": ${JSON.stringify(globs)} }. Use "exclude" for files in that folder that are not test files.`,
    )
  }
  for (const path of [...unknown.map(file => resolve(root, file)), ...types])
    try {
      // A note below says to remove a setup file that only applied migrations.
      if (!spent.includes(rel(path)) && OLD_TOOL.test(readFileSync(path, 'utf8'))) old.push(rel(path))
    } catch {
      // ubq: not measured: the command read each of these files
    }
  if (old.length && changed)
    out(
      `note: these files still name the old test tool: ${old.sort().join(', ')}. Change them before you remove that tool.`,
    )
  // The comments of other coverage tools, in the files that git has
  // or would add.
  const git = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
  })
  const ignores: string[] = []
  for (const file of git.status === 0 ? git.stdout.split('\n') : [])
    if (/\.[cm]?[jt]sx?$/.test(file) && existsSync(join(root, file)))
      readFileSync(join(root, file), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (IGNORE.test(line)) ignores.push(`${file}:${i + 1}`)
        })
  if (ignores.length && changed)
    out(
      `note: ubq does not read c8 or istanbul ignore comments: ${ignores.slice(0, 5).join(', ')}${ignores.length > 5 ? `, and ${ignores.length - 5} more` : ''}. At each range that no test can run, write: // ubq: not measured: <reason>`,
    )
  for (const note of setupNotes) out(note)
  if (spent.length && changed)
    out(
      `note: each test file now applies the D1 migrations (await migrate(...)). The setup file is not necessary: remove ${spent.join(', ')}.`,
    )
  if (vitest && !config().workers) {
    // The complete key, so that the first run loads each file.
    const key = vitest.projects.map(project => project.entry)
    const pkgPath = join(root, 'package.json')
    let wrote = false
    if (!dry)
      try {
        const text = readFileSync(pkgPath, 'utf8')
        const pkg = JSON.parse(text) as { ubq?: Record<string, unknown> }
        pkg.ubq = { ...pkg.ubq, workers: key }
        writeFileSync(pkgPath, JSON.stringify(pkg, null, /^\{\n(\s+)/.exec(text)?.[1] ?? 2) + '\n')
        wrote = true
      } catch {
        // No package.json that is JSON. The text below has the key.
      }
    out(
      `${wrote ? 'wrote "ubq.workers" to package.json' : 'add to "ubq" in package.json'}, from ${vitest.file}: "workers": ${JSON.stringify(key)}`,
    )
    for (const project of vitest.projects) for (const note of project.notes) out(`note: ${note}`)
    // A project can have a second wrangler config for the vitest
    // plugin, which did not load each binding.
    for (const { config: path } of key)
      if (/test/i.test(path.split('/').at(-1)!))
        out(
          `note: ${path} has "test" in its name. If it is a copy of the wrangler config of the Worker that exists only to leave out "containers" or a service binding, it is not necessary: ubq loads a config with them. Then give the config of the Worker in "config", and remove the copy.`,
        )
  } else if (workers && !config().workers)
    out(
      counted`note: ${workers} of these files is|are tests of a Cloudflare Worker. Such a file must run in the Workers runtime. Add to package.json: "ubq": { "workers": [{ "config": "wrangler.jsonc", "include": ["test/**/*.test.ts"] }] }, with the path of the wrangler config and the globs of these files.`,
    )
  // Vite puts each define value in the source. ubq sets it as a
  // global (D83). vitest sets each value of `test.env` in the
  // environment of the tests, and so does ubq (D114).
  const defined = viteDefine(root, parse, children)
  for (const key of ['define', 'env'] as const) {
    if (!defined || config()[key] || !Object.keys(defined[key]).length) continue
    const pkgPath = join(root, 'package.json')
    let wrote = false
    if (!dry)
      try {
        const text = readFileSync(pkgPath, 'utf8')
        const pkg = JSON.parse(text) as { ubq?: Record<string, unknown> }
        pkg.ubq = { ...pkg.ubq, [key]: defined[key] }
        writeFileSync(pkgPath, JSON.stringify(pkg, null, /^\{\n(\s+)/.exec(text)?.[1] ?? 2) + '\n')
        wrote = true
      } catch {
        // No package.json that is JSON. The text below has the key.
      }
    out(
      `${wrote ? `wrote "ubq.${key}" to package.json` : 'add to "ubq" in package.json'}: "${key}": ${JSON.stringify(defined[key])}`,
    )
  }
  for (const note of defined?.notes ?? []) out(`note: ${note}`)
  if (playwright && !config().browser) for (const note of playwrightNotes(root, parse, children)) out(`note: ${note}`)
  // tap writes snapshots when npm starts it for a script named snap
  // or snapshot. In ubq, --update does that.
  try {
    const pkgPath = join(root, 'package.json')
    const text = readFileSync(pkgPath, 'utf8')
    const pkg = JSON.parse(text) as { scripts?: Record<string, string> }
    const scripts = pkg.scripts ?? {}
    const snap = ['snap', 'snapshot'].filter(key => scripts[key] === 'tap')
    if (scripts.test === 'tap' && snap.length) {
      const to = { test: 'ubq', ...Object.fromEntries(snap.map(key => [key, 'ubq --update'])) }
      pkg.scripts = { ...scripts, ...to }
      if (!dry) writeFileSync(pkgPath, JSON.stringify(pkg, null, /^\{\n(\s+)/.exec(text)?.[1] ?? 2) + '\n')
      out(
        `${dry ? 'to change' : 'changed'} the scripts of package.json: ${Object.entries(to)
          .map(([key, value]) => `"${key}": "${value}"`)
          .join(', ')}`,
      )
    }
  } catch {
    // No package.json that is JSON.
  }
  // The changes keep the code correct, not its format.
  const formatted = written.length && !dry ? formatFiles(root, written) : undefined
  if (formatted) out(`note: ${formatted}`)
  // A TODO can look easy. The reader must know why it is there.
  if (todos)
    out(
      'note: this command makes only the changes that are correct in each case. A TODO can be easy to do by hand: the command leaves it if the change is not safe for each program that has that form.',
    )
  if (changed) out('next: read `ubq guide convert`, do each TODO(ubq), then run: ubq')
  return 0
}
