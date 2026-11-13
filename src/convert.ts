// `ubq convert`: changes the test files of a different test tool to
// the API of ubq. It makes each change that is certain, and writes a
// `TODO(ubq)` comment where a person or an agent must decide.
// `ubq guide convert` (CONVERT.md) tells how to do the rest.
//
// The changes are text edits at positions of the syntax tree. An
// argument of a call keeps its text, so a rule for a call and a
// rule for a call in its arguments do not touch the same text.
import { globSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { config, UsageError } from './config.ts'
import type { Node } from './instrument.ts'
import { projectRoot, rel } from './project.ts'
import { setupMigrations, vitestWorkers } from './vitest-config.ts'

// The source is `.ts`, and the bundle is `.js`.
const INSTRUMENT = import.meta.url.endsWith('.ts') ? './instrument.ts' : './instrument.js'

export interface Converted {
  /** The new text of the file. */
  code: string
  /** `tap`, `node:test`, `vitest`, `jest`, `mocha`, or `bun:test`. */
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
  'node:test': 'node:test',
  vitest: 'vitest',
  '@jest/globals': 'jest',
  'bun:test': 'bun:test',
}
const ASSERT_MODULES = new Set(['node:assert', 'node:assert/strict', 'assert', 'assert/strict'])
const HOOKS = new Set(['before', 'after', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll'])
const NOT_CONVERTED: Record<string, string> = {
  chai: 'chai',
  mocha: 'mocha',
  sinon: 'sinon',
  ava: 'ava',
  tape: 'tape',
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
  // `INCLUDES` is `?.includes` for a value from an index or from an
  // optional chain: its type has undefined in it, and expect() took
  // all types. For other values it is `.includes`.
  toContain: 'assert(<$0>INCLUDES($1))',
  toHaveLength: 'assert.equal(<$0>.length, $1)',
  toMatchObject: 'assert.match($0, $1)',
  toBeInstanceOf: 'assert(<$0> instanceof $1)',
  toBeGreaterThan: 'assert(<$0> > <$1>)',
  toBeGreaterThanOrEqual: 'assert(<$0> >= <$1>)',
  toBeLessThan: 'assert(<$0> < <$1>)',
  toBeLessThanOrEqual: 'assert(<$0> <= <$1>)',
  toThrow: { 1: 'assert.throws($0, Error)', 2: 'assert.throws($0, $1)' },
  toThrowError: { 1: 'assert.throws($0, Error)', 2: 'assert.throws($0, $1)' },
  toHaveBeenCalled: 'assert(<$0>.calls.length > 0)',
  toHaveBeenCalledTimes: 'assert.equal(<$0>.calls.length, $1)',
  toHaveBeenCalledOnce: 'assert.equal(<$0>.calls.length, 1)',
  toMatchSnapshot: { 1: 'assert.snapshot($0)' },
  // The default of jest and vitest: 2 digits.
  toBeCloseTo: { 2: 'assert(Math.abs(<$0> - <$1>) < 0.005)' },
  // The same as `key in object`. The arguments keep their order.
  // `Object()`: the value can be undefined, and expect() took that.
  toHaveProperty: { 2: 'assert(Reflect.has(Object($0), $1))' },
  toContainEqual: 'assert(<$0>.some(ITEM => isDeepEqual(ITEM, $1)))',
}
/** With `.not`. A matcher that is not here and makes `assert(x)` becomes `assert(!(x))`. */
const NOT_MATCHERS: Record<string, Rule> = {
  toBe: 'assert.notEqual($0, $1)',
  toEqual: 'assert(!isDeepEqual($0, $1))',
  toStrictEqual: 'assert(!isDeepEqual($0, $1))',
  toContain: 'assert(!<$0>.includes($1))',
  toBeNull: 'assert.notEqual($0, null)',
  toBeUndefined: 'assert.notEqual($0, undefined)',
  toBeDefined: 'assert.equal($0, undefined)',
  toBeTruthy: 'assert(!<$0>)',
  toBeFalsy: 'assert($0)',
}

/** `t.name(a, b)` of tap: `$0` is `a`. A message after the last argument goes into a comment. */
const TAP: Record<string, Rule> = {}
const tap = (names: string, rule: Rule): void => {
  for (const name of names.split(' ')) TAP[name] = rule
}
tap('equal equals is strictEqual strictEquals isEqual isStrict', 'assert.equal($0, $1)')
tap('not notEqual inequal notStrictEqual isNot isNotEqual doesNotEqual', 'assert.notEqual($0, $1)')
tap('same strictSame deepEqual deepEquals strictDeepEqual looseEqual equivalent', 'assert.deepEqual($0, $1)')
tap('ok true assert', 'assert($0)')
tap('notOk false assertNot', 'assert(!<$0>)')
tap('match has hasStrict matchStrict matchOnly', 'assert.match($0, $1)')
tap('throws throw', { 1: 'assert.throws($0, Error)', 2: 'assert.throws($0, $1)' })
tap('rejects', { 1: 'assert.rejects($0, Error)', 2: 'assert.rejects($0, $1)' })
tap('resolveMatch resolveMatchSnapshot', 'assert.match(await $0, $1)')
tap('pass', { 0: 'assert(true)', 1: 'assert(true)' })
tap('fail', { 0: "assert.fail('fail')", 1: 'assert.fail($0)' })
tap('error ifError ifErr', 'assert(!<$0>)')
tap('matchSnapshot', 'assert.snapshot($0)')
tap('teardown after', 'cleanup($0)')
tap('testdir', { 0: 'testdir()', 1: 'testdir($0)' })

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
    'ubq has no hooks. Make a function that does this work one time, and await it at the start of each test of the group: let ready; const setup = () => (ready ??= work()).',
  matcher:
    "ubq has no expect. In assert.match, a partial object does the work of objectContaining, and a RegExp does the work of stringContaining and stringMatching. For any(String), assert on typeof. For arrayContaining, assert on each element: assert(list.includes(x)), or assert(list.some(item => isDeepEqual(item, x))) for an object.",
  throwsText:
    'vitest and jest accept a string here. assert.throws needs an Error class, a RegExp, or a partial object. If this value is a string, make a RegExp from it.',
  workers:
    "ubq has no 'cloudflare:test'. 'ubqtest/workers' has executionContext, scheduledController, and migrate. Write the test without the other names.",
  restore:
    'A spyOn spy goes back when its test ends. Remove this call, if the code after it does not need the real method: a second spyOn on a key replaces the first. ubq has no call that puts the method back before the test ends.',
  subtests:
    'ubq has no test in a test. This is a describe() now. Move the assertions and the setup that are not in a subtest into a test() or a setup function.',
  rootAssert: 'ubq needs each assertion in a test. Put this in a test().',
  passed: 'ubq has no test object to pass to a function. Remove this argument, and the parameter of the function. The function imports assert from ubqtest.',
  skip: "Give the reason: { skip: 'the reason' }.",
  context: 'ubq has no test object. Use the functions of ubqtest in place of the parameter of this test function.',
  done: 'ubq has no done callback. Make the test function async, and await a promise.',
  mock: "Use mockImport: await mockImport(() => import('../src/a.ts'), [[() => import('../src/dep.ts'), { fn }]]). It gives a new instance of a.ts.",
  spyImpl: 'A spy gets its implementation as an argument: spy(impl), spyOn(object, key, impl). A call is spy.calls[i]: { args, result, error }.',
  timers: 'Use fakeClock: const clock = fakeClock({ now: 0 }), then await clock.tick(ms).',
  each: 'Use a for loop around test().',
  only: 'ubq has no .only. Run one test with: ubq <file>:<line>.',
  resolves: 'A test needs an assertion. Await the promise and assert on its value.',
} as const

const SIMPLE = new Set([
  'Identifier',
  'MemberExpression',
  'CallExpression',
  'NewExpression',
  'Literal',
  'TemplateLiteral',
  'ThisExpression',
  'ArrayExpression',
])

const FUNCTION = new Set(['ArrowFunctionExpression', 'FunctionExpression'])

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
  const bind = (module: string, imported: string, local: string): void => {
    if (ASSERT_MODULES.has(module)) {
      roles.set(local, imported === 'default' || imported === '*' || imported === 'strict' ? 'assert' : `assert.${imported}`)
      return
    }
    if (module === 'tap') {
      if (imported === 'test') tapTests.add(local)
      roles.set(local, imported === 'test' ? 'test' : imported === 'default' || imported === '*' || imported === 't' ? 'tap' : 'hook')
      // The test object has the name `t` in almost all tap tests,
      // also in a helper function that gets it as an argument.
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
  }
  /** The imports of `cloudflare:test`, and what becomes of their names. */
  const workersImports: Node[] = []
  /** `env`: the runtime has it in `cloudflare:workers`. */
  const workersKept: string[] = []
  /** Names that `ubqtest/workers` has no function for. */
  const workersLeft: string[] = []
  /** Names to import from `ubqtest/workers`. */
  const workersUsed = new Set<string>()
  const known = (module: string): boolean => module in FRAMEWORKS || ASSERT_MODULES.has(module)
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
        for (const s of specifiers) {
          const name = (s.imported as { name: string }).name
          const local = (s.local as { name: string }).name
          if (name === 'env') workersKept.push(name === local ? name : `${name} as ${local}`)
          else if (name in WORKERS) roles.set(local, `cf.${name}`)
          else workersLeft.push(text(s))
        }
        continue
      }
      if (module in NOT_CONVERTED) other = NOT_CONVERTED[module]
      if (!known(module)) continue
      if (FRAMEWORKS[module]) framework = FRAMEWORKS[module]
      removed.push(node)
      for (const s of node.specifiers as Node[]) {
        const local = (s.local as { name: string }).name
        const imported =
          s.type === 'ImportDefaultSpecifier' ? 'default'
          : s.type === 'ImportNamespaceSpecifier' ? '*'
          : ((s.imported as { name?: string; value?: string }).name ?? (s.imported as { value: string }).value)
        bind(module, imported, local)
      }
    } else if (node.type === 'VariableDeclaration') {
      // const t = require('tap'), const { test } = require('node:test')
      const decls = node.declarations as Node[]
      const init = decls[0]?.init as Node | undefined
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
  /** The statement that has a node in it, from the path to the node. */
  const statementOf = (path: Node[]): Node => {
    for (let i = path.length - 1; i > 0; i--) {
      const parent = path[i - 1]!
      if (parent.type === 'Program' || parent.type === 'BlockStatement' || parent.type === 'SwitchCase') return path[i]!
    }
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

  /**
   * Changes a call to the text of a rule. The arguments that the
   * rule names keep their text. Returns those arguments: the walk
   * goes on in them.
   */
  const rewrite = (node: Node, rule: string, args: Node[]): Node[] => {
    // A name for the parameter of a callback that the arguments do not use.
    if (rule.includes('INCLUDES')) {
      const subject = args[0]!
      const optional = (subject.type === 'MemberExpression' && subject.computed) || subject.type === 'ChainExpression' || text(subject).includes('?.')
      rule = rule.replace('INCLUDES', optional ? '?.includes' : '.includes')
    }
    if (rule.includes('ITEM')) rule = rule.replaceAll('ITEM', ['item', 'element', 'entry', 'one'].find(name => !args.some(arg => mentions(arg, name))) ?? '_item')
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
    for (const name of rule.match(/\b(assert|cleanup|testdir|spy|spyOn|mockImport|isDeepEqual)\b/g) ?? []) used.add(name)
    if (!parts.length) {
      replace(node.start, node.end, pieces[0]!)
      return []
    }
    replace(node.start, parts[0]!.start, pieces[0]!)
    for (let i = 1; i < parts.length; i++) replace(parts[i - 1]!.end, parts[i]!.start, pieces[i]!)
    replace(parts.at(-1)!.end, node.end, pieces.at(-1)!)
    return parts
  }
  const pick = (rule: Rule, argc: number): string | undefined =>
    typeof rule === 'string' ? (argc >= (rule.match(/\$\d/g)?.length ?? 0) ? rule : undefined)
    : (rule[argc] ?? rule[Math.max(...Object.keys(rule).map(Number).filter(n => n <= argc))])

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

  /** The message of an assertion, as a comment at the end of the line. */
  const messageComment = (node: Node, message: Node | undefined, path: Node[]): void => {
    if (message?.type !== 'Literal' || typeof message.value !== 'string') return
    if (path.at(-2)?.type !== 'ExpressionStatement') return
    const end = source.indexOf('\n', node.end)
    const rest = source.slice(node.end, end < 0 ? source.length : end)
    if (/^\s*;?\s*$/.test(rest) && !message.value.includes('\n'))
      edits.push({ start: node.end + rest.length, end: node.end + rest.length, text: ` // ${message.value}` })
  }

  /** Removes the statement of a call: `t.end()`, `t.plan(3)`. */
  const removeStatement = (path: Node[]): boolean => {
    const stmt = path.at(-2)
    if (stmt?.type !== 'ExpressionStatement') return false
    const from = lineStart(stmt.start)
    const end = source.indexOf('\n', stmt.end)
    const alone = !source.slice(from, stmt.start).trim() && /^\s*;?\s*$/.test(source.slice(stmt.end, end < 0 ? source.length : end))
    if (alone) replace(from, end < 0 ? source.length : end + 1, '')
    else replace(stmt.start, stmt.end, '')
    changes++
    return true
  }

  /** The text from the start of the parameters of a function to their end, with the parentheses. */
  const paramSpan = (fn: Node): [number, number] | undefined => {
    const params = fn.params as Node[]
    if (!params.length) return undefined
    const open = source.lastIndexOf('(', params[0]!.start)
    const body = fn.body as Node
    // `t => {}` has no parentheses.
    const head = source.slice(fn.start, params[0]!.start)
    if (open < fn.start || !head.includes('(')) return [params[0]!.start, params.at(-1)!.end]
    const close = source.lastIndexOf(')', source.lastIndexOf(fn.type === 'ArrowFunctionExpression' ? '=>' : '{', body.start))
    return close > open ? [open, close + 1] : undefined
  }

  /** True if `name` is in the text of a node, as a word. */
  const mentions = (node: Node, name: string): boolean => new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])`).test(text(node))

  /** `vi.restoreAllMocks()`, `mock.restoreAll()`. */
  const restoresAll = (node: Node | undefined): boolean => {
    const callee = node?.type === 'CallExpression' ? (node.callee as Node) : undefined
    if (callee?.type !== 'MemberExpression') return false
    const owner = roleOf(callee.object as Node)
    const method = nameOf(callee.property as Node)
    return (owner === 'vi' && method === 'restoreAllMocks') || (owner === 'mock' && method === 'restoreAll')
  }
  /** A function that does nothing but `vi.restoreAllMocks()`. */
  const restoresOnly = (fn: Node | undefined): boolean => {
    if (!fn || !FUNCTION.has(fn.type)) return false
    const body = fn.body as Node
    if (body.type !== 'BlockStatement') return restoresAll(body)
    const statements = body.body as unknown as Node[]
    return statements.length === 1 && statements[0]!.type === 'ExpressionStatement' && restoresAll(statements[0]!.expression as Node)
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
    const name = body.type === 'CallExpression' && !(body.arguments as Node[]).length ? nameOf(body.callee as Node) : undefined
    return name && /restore/i.test(name) ? name : undefined
  }
  /** True if the statement of a call is the last one of a function. */
  const lastInFunction = (path: Node[]): boolean => {
    const [fn, block, statement] = path.slice(-4)
    return !!fn && FUNCTION.has(fn.type) && block?.type === 'BlockStatement' && (block.body as unknown as Node[]).at(-1) === statement
  }
  /**
   * `beforeAll(async () => { ... })` at the top level of a file
   * becomes the block `{ ... }` at the same place: code at the top
   * level runs one time, before the tests. Returns the block, or
   * undefined if the change is not certain: the code can use a name
   * that the file declares below it, and that name has no value yet
   * at this place.
   */
  const topLevelBlock = (node: Node, path: Node[]): Node | undefined => {
    const statement = path.at(-2)
    const args = node.arguments as Node[]
    const fn = args[0]
    if (statement?.type !== 'ExpressionStatement' || path.at(-3)?.type !== 'Program' || args.length !== 1) return undefined
    if (!fn || !FUNCTION.has(fn.type) || (fn.params as Node[]).length) return undefined
    const body = fn.body as Node
    if (body.type !== 'BlockStatement') return undefined
    // A `return` of the function has no meaning in a block.
    const returns = (n: Node): boolean =>
      n.type === 'ReturnStatement' || (!FUNCTION.has(n.type) && n.type !== 'FunctionDeclaration' && children(n).some(returns))
    if (children(body).some(returns)) return undefined
    for (const later of program.body as Node[]) {
      if (later.start < statement.end) continue
      const declared = /^Export/.test(later.type) ? ((later.declaration as Node | undefined) ?? later) : later
      if (declared.type !== 'VariableDeclaration' && declared.type !== 'ClassDeclaration') continue
      const head = declared.type === 'ClassDeclaration' ? text(declared.id as Node) : (declared.declarations as Node[]).map(d => text(d.id as Node)).join(' ')
      for (const name of head.match(/[A-Za-z_$][\w$]*/g) ?? []) if (mentions(body, name)) return undefined
    }
    replace(node.start, body.start, '')
    replace(body.end, node.end, '')
    changes++
    return body
  }
  const inHook = (path: Node[]): boolean =>
    path.some(n => n.type === 'CallExpression' && roleOf(n.callee as Node) === 'hook')

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
      owner !== 'vi' && owner !== 'mock' ? undefined
      : maker === 'fn' && !inner.length ? 'spy'
      : (maker === 'spyOn' || (owner === 'mock' && maker === 'method')) && inner.length === 2 ? 'spyOn'
      : undefined
    if (!name) return undefined
    // `() => {}` with an object in it is a block.
    const [before, after] = method !== 'mockImplementation' && value.type === 'ObjectExpression' && !wrap[1] ? [wrap[0] + '(', ')'] : wrap
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
    if (nameOf(calls.property as Node) !== 'calls' || use?.type !== 'MemberExpression' || use.object !== calls) return false
    if (!use.computed) {
      if (nameOf(use.property as Node) !== 'length') return false
    } else {
      // `s.mock.calls[0]!` has one more node around it.
      const outer = path.at(-4)?.type === 'TSNonNullExpression' ? path.at(-4)! : use
      const next = path.at(outer === use ? -4 : -5)
      const optional = next?.type === 'MemberExpression' && next.object === outer && next.optional
      edits.push({ start: outer.end, end: outer.end, text: optional ? '?.args' : '.args' })
    }
    replace((node.object as Node).end, calls.end, '.calls')
    changes++
    return true
  }

  // --- The rules ---
  /** A test or a group: `it(...)`, `test(...)`, `t.test(...)`, `describe(...)`. */
  const definition = (call: Node, path: Node[], kind: 'test' | 'describe', fromTap: boolean): void => {
    const args = call.arguments as Node[]
    const callee = call.callee as Node
    const fn = args.find(a => FUNCTION.has(a.type))
    let name: 'test' | 'describe' = kind
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
          return c?.type === 'MemberExpression' && nameOf(c.object as Node) === param && nameOf(c.property as Node) === 'test'
        }
        if (direct.some(isSub)) {
          name = 'describe'
          // The rest of the body must be in a test.
          const own = direct.filter(s => !isSub(s) && mentions(s, param) && !/^\s*\w+\.(end|plan)\(/.test(text(s)))
          const waits = direct.some(s => !isSub(s) && /\bawait\b/.test(text(s)))
          if (own.length || waits) todo(path, TODO.subtests)
          // The function of a describe is not async. With an await
          // in it, the function stays as it is until the TODO is done.
          if (fn.async && !waits) replace(fn.start, fn.start + 'async'.length + (source[fn.start + 5] === ' ' ? 1 : 0), '')
        }
        const span = paramSpan(fn)
        if (span) replace(span[0], span[1], '()')
      } else if (param && kind === 'test') {
        // The test object of node:test, or the done callback of jest.
        if (mentions(body, param)) todo(path, framework === 'node:test' || framework === 'bun:test' ? TODO.context : TODO.done)
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
        if (key === 'skip' && !(value?.type === 'Literal' && typeof value.value === 'string') && value?.type !== 'TemplateLiteral')
          todo(path, TODO.skip)
        if (key === 'only') todo(path, TODO.only)
        if (key === 'todo') todo(path, TODO.skip)
      }
    used.add(name)
    if (text(callee) !== name) changes++
    replace(callee.start, callee.end, name)
  }

  const walk = (node: Node, path: Node[]): void => {
    path = [...path, node]
    let next: Node[] | undefined
    if (node.type === 'CallExpression') next = call(node, path)
    else if (node.type === 'MemberExpression') {
      // spy.mock.calls of jest and vitest
      const parent = path.at(-2)
      if (nameOf(node.property as Node) === 'mock' && parent?.type === 'MemberExpression' && /^(calls|results|lastCall)$/.test(nameOf(parent.property as Node) ?? '')) {
        if (!spyCalls(node, path)) todo(path, TODO.spyImpl)
      }
      // mock.timers.enable() of node:test
      else if (roleOf(node.object as Node) === 'mock' && nameOf(node.property as Node) === 'timers') todo(path, TODO.timers)
    }
    else if (node.type === 'Identifier' && roleOf(node) === 'tap') {
      // helper(t, value)
      const parent = path.at(-2)
      if (parent?.type === 'CallExpression' && (parent.arguments as Node[]).includes(node)) todo(path, TODO.passed)
    }
    for (const child of next ?? children(node)) walk(child, path)
  }

  /** Changes a call. Returns the nodes to walk next, or undefined for all children. */
  const call = (node: Node, path: Node[]): Node[] | undefined => {
    const callee = node.callee as Node
    const args = node.arguments as Node[]
    const role = roleOf(callee)
    if (role === 'test' || role === 'describe') {
      definition(node, path, role, tapTests.has(nameOf(callee)!))
      return args
    }
    if (role === 'hook') {
      if (restoresOnly(args[0]) && removeStatement(path)) return []
      const once = /^(before|after)(All)?$/.exec(nameOf(callee) ?? '')
      const inner = path.some(n => FUNCTION.has(n.type) || n.type === 'FunctionDeclaration')
      if (once?.[1] === 'before' && !inner) {
        const body = topLevelBlock(node, path)
        if (body) return [body]
      }
      const restore = restoreCall(args[0])
      todo(
        path,
        restore ? `If this only puts spies back, delete it, each assignment to ${restore}, and each call of ${restore}() or of the function that was assigned. Then remove that function from the helper that gives it. A spyOn spy goes back when its test ends, and a second spyOn on a key replaces the first. If it does other work: ${TODO.hook}`
        : !once ? TODO.hook
        : inner ? TODO.hookGroup
        : once[1] === 'before' ? TODO.hookFile
        : TODO.hookFileEnd,
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
        const binding = first?.type === 'MemberExpression' && !first.computed ? nameOf(first.property as Node) : undefined
        if (!binding) {
          todo(path, "Use migrate('DB') of 'ubqtest/workers', with the name of the D1 binding. It applies the files of migrations_dir in the wrangler config.")
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
    const method = nameOf(callee.property as Node)
    if (!method) return undefined
    const owner = roleOf(object)

    if (owner === 'tap') return tapCall(node, path, method)
    if (owner === 'assert') return assertCall(node, path, method)
    if (owner === 'test' || owner === 'describe') {
      // it.skip, describe.only, test.todo, test.each
      const base = owner
      if (method === 'skip' && args[0]) {
        replace(callee.start, callee.end, base)
        edits.push({ start: args[0].end, end: args[0].end, text: ", { skip: 'TODO(ubq): the reason' }" })
        todo(path, TODO.skip)
      } else if (method === 'only') {
        replace(callee.start, callee.end, base)
        todo(path, TODO.only)
      } else if (method === 'todo' && args.length === 1) {
        replace(callee.start, callee.end, base)
        edits.push({ start: args[0]!.end, end: args[0]!.end, text: ", { skip: 'todo' }, () => {}" })
      } else {
        todo(path, method === 'each' ? TODO.each : `ubq has no ${base}.${method}.`)
        return undefined
      }
      used.add(base)
      changes++
      return args
    }
    if (owner === 'expect') {
      // expect.any(Number), expect.stringContaining('text')
      const first = args[0]
      if (method === 'stringContaining' && args.length === 1 && first?.type === 'Literal' && typeof first.value === 'string') {
        replace(node.start, first.start, '')
        messageRegExp(first)
        replace(first.end, node.end, '')
        changes++
        return []
      }
      todo(path, TODO.matcher)
      return undefined
    }
    if (owner === 'vi' || owner === 'mock') {
      if (method === 'fn') {
        replace(callee.start, callee.end, 'spy')
        used.add('spy')
        changes++
      } else if (method === 'spyOn' || (owner === 'mock' && method === 'method')) {
        replace(callee.start, callee.end, 'spyOn')
        used.add('spyOn')
        changes++
      } else if (restoresAll(node)) {
        // ubq does this when each test ends.
        if (!(inHook(path) || lastInFunction(path)) || !removeStatement(path)) todo(path, TODO.restore)
        return []
      } else
        todo(
          path,
          /mock|Mock|module/.test(method) ? TODO.mock
          : /[Tt]imer|Time/.test(method) ? TODO.timers
          : `ubq has no ${nameOf(object)}.${method}.`,
        )
      return undefined
    }
    if (/^mock(Implementation|ReturnValue|ResolvedValue|RejectedValue|Reset|Clear|Restore)(Once)?$/.test(method)) {
      const found = spyChain(node, object, method)
      if (found) return found
      todo(path, method === 'mockRestore' ? TODO.restore : TODO.spyImpl)
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
    if (base.type !== 'CallExpression' || roleOf(base.callee as Node) !== 'expect') return undefined
    const subject = (base.arguments as Node[])[0]
    if (!subject) return undefined
    const all = [subject, ...args]
    const fail = (): undefined => {
      todo(path, `ubq has no ${not ? 'not.' : ''}${promise ? promise + '.' : ''}${method}. Write an assertion with assert, assert.equal, assert.deepEqual, or assert.match.`)
      return undefined
    }
    if (method === 'toMatch' && args[0]) {
      // A value can be text or a RegExp, and the two have different forms.
      if (args[0].type !== 'Literal' && args[0].type !== 'TemplateLiteral') {
        todo(path, 'toMatch takes text or a RegExp. For a RegExp: assert.match(value, pattern). For text: assert(value.includes(text)).')
        return undefined
      }
      const regex = args[0].type === 'Literal' && (args[0] as { regex?: unknown }).regex
      // The arguments of a rule keep their order, so not `re.test(a)`.
      return rewrite(node, regex ? (not ? 'assert(!<$0>.match($1))' : 'assert.match($0, $1)') : `assert(${not ? '!' : ''}<$0>.includes($1))`, all)
    }
    if (/^toHaveBeen(Last)?CalledWith$/.test(method) && !not && !promise) {
      // The arguments of the last call.
      changes++
      used.add('assert')
      replace(node.start, subject.start, 'assert.deepEqual(')
      if (!args.length) replace(subject.end, node.end, '.calls.at(-1)?.args, [])')
      else {
        replace(subject.end, args[0]!.start, '.calls.at(-1)?.args, [')
        replace(args.at(-1)!.end, node.end, '])')
      }
      return all
    }
    if (promise === 'rejects' && /^toThrow(Error)?$/.test(method) && !not) {
      messageRegExp(args[0])
      awaited(node, path)
      return rewrite(node, args.length ? 'assert.rejects($0, $1)' : 'assert.rejects($0, Error)', all)
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
      messageRegExp(args[0])
      // A name with a small first letter is a value, not a class.
      if (args[0]?.type === 'Identifier' && /^[a-z]/.test(nameOf(args[0])!)) todo(path, TODO.throwsText)
    }
    return rewrite(node, rule, all)
  }

  const assertCall = (node: Node, path: Node[], method: string): Node[] | undefined => {
    const args = node.arguments as Node[]
    const rule = ASSERT[method] && pick(ASSERT[method], args.length)
    if (!rule) {
      todo(path, `ubq has no assert.${method}. Write an assertion with assert, assert.equal, assert.deepEqual, assert.match, or assert.throws.`)
      return undefined
    }
    if (method === 'rejects') awaited(node, path)
    const count = rule.match(/\$\d/g)?.length ?? 0
    // A message is the argument after the last one of the rule.
    if (method !== 'fail') messageComment(node, args[count], path)
    return rewrite(node, rule, args)
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
      if (!removeStatement(path)) todo(path, `ubq has no t.${method}. A test ends when its function ends.`)
      return []
    }
    if (method === 'comment') {
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
      const plain = entries?.every(p => p.type === 'Property' && !p.computed && !p.shorthand && (p.key as Node).type === 'Literal')
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
    const rule = TAP[method] && pick(TAP[method], args.length)
    if (!rule) {
      todo(path, `ubq has no form of t.${method}. See: ubq guide convert.`)
      return undefined
    }
    // tap: t.throws(fn, 'message') has a message, and no expected error.
    const count = rule.match(/\$\d/g)?.length ?? 0
    let use = rule
    if (/^(throws|throw|rejects)$/.test(method) && args[1]?.type === 'Literal' && typeof args[1].value === 'string') {
      use = pick(TAP[method]!, 1)!
      messageComment(node, args[1], path)
    } else if (!/^(fail|teardown|after|testdir)$/.test(method)) messageComment(node, args[count], path)
    if (method === 'rejects' || method.startsWith('resolveMatch')) awaited(node, path)
    if (!inTest && use.startsWith('assert')) todo(path, TODO.rootAssert)
    return rewrite(node, use, args)
  }

  walk(program, [])

  // --- The import of ubqtest, in place of the old imports ---
  const names = [...used].sort().join(', ')
  const line = names ? (commonJs ? `const { ${names} } = require('ubqtest')` : `import { ${names} } from 'ubqtest'`) : ''
  removed.forEach((node, i) => {
    const end = source[node.end] === '\n' ? node.end + 1 : node.end
    if (i === 0) replace(node.start, node.end, line)
    else replace(lineStart(node.start) === node.start ? node.start : node.start, end, '')
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
      todos.set(
        workersImport.start,
        (todos.get(workersImport.start) ?? new Set()).add(TODO.workers),
      )
    }
    replace(workersImport.start, workersImport.end, lines.join('\n'))
    changes++
  }
  for (const [at, messages] of todos) {
    const from = lineStart(at)
    const indent = /^\s*/.exec(source.slice(from, at))![0]
    edits.push({ start: from, end: from, text: [...messages].map(m => `${indent}// TODO(ubq): ${m}\n`).join('') })
  }

  // Text that is put in comes before a change at the same place.
  edits.sort((a, b) => a.start - b.start || a.end - b.end)
  let code = ''
  let at = 0
  for (const edit of edits) {
    if (edit.start < at)
      throw new Error(`the command cannot change line ${source.slice(0, edit.start).split('\n').length}. Write that statement in a different form, or convert this file by hand.`)
    code += source.slice(at, edit.start) + edit.text
    at = edit.end
  }
  code += source.slice(at)
  // The setup file of the vitest config applied the migrations of
  // D1 for each test file. In ubq, the test file does that.
  const lines = migrate.filter(binding => !code.includes(`migrate('${binding}')`)).map(binding => `await migrate('${binding}')`)
  if (lines.length) {
    const imports = (parse(code, file).body as Node[]).filter(n => n.type === 'ImportDeclaration')
    const helpers = imports.find(n => (n.source as { value?: unknown }).value === 'ubqtest/workers')
    const at = imports.at(-1)?.end ?? 0
    let added = `${helpers ? '' : "\nimport { migrate } from 'ubqtest/workers'"}\n\n${lines.join('\n')}`
    if (!at) added = added.trimStart() + '\n'
    code = code.slice(0, at) + added + code.slice(at)
    if (helpers && !/\bmigrate\b/.test(code.slice(helpers.start, helpers.end)))
      code =
        code.slice(0, helpers.start) +
        code
          .slice(helpers.start, helpers.end)
          .replace(/\{([^}]*)\}/, (_, names: string) => `{ ${[...names.split(',').map(name => name.trim()).filter(Boolean), 'migrate'].sort().join(', ')} }`) +
        code.slice(helpers.end)
    changes++
  }
  // The new text must be code.
  parse(code, file)
  const found: Converted['todos'] = []
  code.split('\n').forEach((text, i) => {
    const m = /\/\/ TODO\(ubq\): (.*)$/.exec(text) ?? /'TODO\(ubq\): (the reason)'/.exec(text)
    if (m && text.trim().startsWith('//')) found.push({ line: i + 1, text: m[1]! })
  })
  return { code, framework, changes: changes + removed.length, todos: found }
}

/** A file that can have code. Not a declaration file. */
const CODE = /(?<!\.d)\.([cm]?[jt]s|[jt]sx)$/
/** The default name of a test file. */
const TEST_NAME = /\.test\.([cm]?[jt]s|[jt]sx)$/

/** `ubq convert <files or folders>`. Prints the report with `out`. Returns the exit code. */
export const convertCommand = (args: string[], out: (text: string) => void): number => {
  const dry = args.includes('--dry')
  const paths = args.filter(a => a !== '--dry')
  if (!paths.length || paths.some(p => p.startsWith('--')))
    throw new UsageError(
      'ubq convert needs test files or folders, such as: ubq convert test. With --dry, it changes no file.',
    )
  const { parse, children } = createRequire(import.meta.url)(INSTRUMENT) as typeof import('./instrument.ts')
  const files: string[] = []
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
        if (CODE.test(name) && !/(^|[\\/])(node_modules|\.[^\\/]+)[\\/]/.test(name)) files.push(join(full, name))
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
  let changed = 0
  let todos = 0
  /** Files that use no test tool that this command knows. */
  const unknown: string[] = []
  /** The text of each hint of the report, in the order of its first place. */
  const hints: string[] = []
  let failed = 0
  const unnamed: string[] = []
  let workers = 0
  for (const path of files.sort()) {
    const file = rel(path)
    let result: Converted | undefined
    try {
      result = convertSource(readFileSync(path, 'utf8'), path, parse, children, migrations.get(path))
    } catch (error) {
      out(`not converted ${file}: ${(error as Error).message}`)
      failed++
      continue
    }
    if (!result) {
      unknown.push(file)
      continue
    }
    changed++
    todos += result.todos.length
    if (!dry) writeFileSync(path, result.code)
    // A file with no tests is a helper. Its name is not a problem.
    if (!TEST_NAME.test(file) && /^\s*(test|describe)\(/m.test(result.code)) unnamed.push(file)
    if (/from\s+['"](cloudflare:|ubqtest\/workers)/.test(result.code)) workers++
    out(`converted ${file} (${result.framework}): ${result.changes} changes, ${result.todos.length} TODO`)
    // The text of a hint is long, and many places have the same
    // one. A place has the number of its hint and the first
    // sentence. The full text of each hint is below the files.
    for (const t of result.todos) {
      if (!hints.includes(t.text)) hints.push(t.text)
      out(`  ${file}:${t.line}  [${hints.indexOf(t.text) + 1}] ${/^.*?[.:](?=\s|$)/.exec(t.text)?.[0] ?? t.text}`)
    }
  }
  if (hints.length) out('hints:')
  hints.forEach((text, i) => out(`  [${i + 1}] ${text}`))
  const parts = [`${changed} files ${dry ? 'to change' : 'changed'}`, `${todos} TODO comments`]
  if (failed) parts.push(`${failed} files not converted (see the lines above)`)
  if (unknown.length) {
    const more = unknown.length > 10 ? `, and ${unknown.length - 10} more` : ''
    parts.push(`${unknown.length} files with no known test tool (${unknown.slice(0, 10).join(', ')}${more})`)
  }
  out(`convert: ${parts.join(', ')}`)
  if (unnamed.length && !config().include) {
    const folders = [...new Set(unnamed.map(f => f.split('/')[0]!))]
    const globs = folders.map(f => (unnamed.includes(f) ? f : `${f}/**/*.${/\.[cm]?tsx?$/.test(unnamed[0]!) ? 'ts' : 'js'}`))
    out(
      `note: ${unnamed.length} of these files have tests, and do not have a name that ubq runs (*.test.ts): ${unnamed.slice(0, 5).join(', ')}${unnamed.length > 5 ? ', ...' : ''}. Rename them, or add to package.json: "ubq": { "include": ${JSON.stringify(globs)} }. Use "exclude" for files in that folder that are not test files.`,
    )
  }
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
      `note: ${workers} of these files are tests of a Cloudflare Worker. They must run in the Workers runtime. Add to package.json: "ubq": { "workers": [{ "config": "wrangler.jsonc", "include": ["test/**/*.test.ts"] }] }, with the path of the wrangler config and the globs of these files.`,
    )
  // A TODO can look easy. The reader must know why it is there.
  if (todos)
    out(
      'note: this command makes only the changes that are correct in each case. A TODO can be easy to do by hand: the command leaves it if the change is not safe for each program that has that form.',
    )
  if (changed) out('next: read `ubq guide convert`, do each TODO(ubq), then run: ubq')
  return 0
}

