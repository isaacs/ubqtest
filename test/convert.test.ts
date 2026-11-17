// `ubq convert`: test files of a different test tool, as ubq tests.
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { assert, cleanup, test } from 'ubqtest'
import { convertSource, todoComment } from '../src/convert.ts'
import { project } from './setup.ts'

// The load hook of the counters loads the parser with `require`,
// while this file loads. A static import of the same module from
// this file is an error in Node (a cycle of `require` and `import`).
// Deno cannot load this module with `require`.
const { parse, children }: typeof import('../src/instrument.ts') = process.versions.deno
  ? await import('../src/instrument.ts')
  : createRequire(import.meta.url)('../src/instrument.ts')

/** The TODO text for a matcher of expect. */
const MATCHER =
  'ubq has no expect. In assert.match, a partial object does the work of objectContaining, and a RegExp does the work of stringContaining and stringMatching. An object pattern is partial at each depth, and an array pattern must have the same length. For any(String), assert on typeof. For arrayContaining, assert on each element: assert.contains(list, x), or assert(list.some(item => isDeepEqual(item, x))) for an object.'

/** The lines of a TODO comment. */
const todo = (text: string, indent = ''): string[] => todoComment(indent, text).trimEnd().split('\n')

const convert = (source: string, file = 'a.ts') => {
  const r = convertSource(source, file, parse, children)
  return r && { ...r, code: r.code.trimEnd().split('\n') }
}

test('tap: tests, assertions, messages, end and plan, subtests, mockImport', () => {
  const r = convert(`import t from 'tap'
import { parse, load } from '../src/shape.js'

t.test('basic', t => {
  t.equal(parse('c')?.kind, 'circle', 'the kind')
  t.strictSame(parse('s'), { kind: 'square', side: 2 })
  t.notOk(parse('x') || false)
  t.throws(() => parse('?'), 'throws')
  t.type(parse('c'), 'object')
  t.end()
})
t.test('async', async t => {
  t.plan(1)
  t.rejects(load('x'), /no shape/)
  t.teardown(() => {})
})
t.test('group', t => {
  t.test('one', async t => {
    const m = await t.mockImport<typeof import('../src/a.js')>('../src/a.js', { '../src/b.js': { f: () => 1 } })
    t.ok(m)
  })
  t.end()
})
t.beforeEach(() => {})
t.equal(1, 1)
`)
  assert(r)
  assert.deepEqual(r.code, [
    "import { assert, cleanup, describe, mockImport, test } from 'ubqtest'",
    "import { parse, load } from '../src/shape.js'",
    '',
    "test('basic', () => {",
    "  assert.equal(parse('c')?.kind, 'circle') // the kind",
    "  assert.deepEqual(parse('s'), { kind: 'square', side: 2 })",
    "  assert(!(parse('x') || false))",
    "  assert.throws(() => parse('?'), Error) // throws",
    "  assert.equal(typeof parse('c'), 'object')",
    '})',
    "test('async', async () => {",
    "  await assert.rejects(load('x'), /no shape/)",
    '  cleanup(() => {})',
    '})',
    "describe('group', () => {",
    "  test('one', async () => {",
    "    const m = await mockImport(() => import('../src/a.js'), [[() => import('../src/b.js'), { f: () => 1 }]])",
    '    assert(m)',
    '  })',
    '})',
    '// TODO(ubq): ubq has no hooks. Make a setup function and call it in each',
    '// test. Use cleanup() for the work after a test.',
    't.beforeEach(() => {})',
    '// TODO(ubq): ubq needs each assertion in a test. Put this in a test().',
    'assert.equal(1, 1)',
  ])
  assert.deepEqual([r.framework, r.todos.map(t => t.line)], ['tap', [21, 24]])
})

test('vitest: expect, not, promises, spies, skip, a time limit', () => {
  const r = convert(`import { describe, it, expect, vi } from 'vitest'
describe('g', () => {
  it('a', async () => {
    expect(f()).toEqual({ a: 1 })
    expect(f().a).not.toBe(2)
    expect(a || b).toBeFalsy()
    expect([1]).not.toContain(2)
    expect(() => f()).toThrow('bad (x)')
    await expect(p).rejects.toThrow(TypeError)
    expect(p).resolves.toBe(1)
    const s = vi.fn(() => 1)
    expect(s).toHaveBeenCalledWith(1, 2)
    expect(f()).toSatisfy(ok)
  })
  it.skip('b', () => {})
  it('c', () => {}, 100)
})
`)
  assert(r)
  assert.deepEqual(r.code, [
    "import { assert, describe, spy, test } from 'ubqtest'",
    "describe('g', () => {",
    "  test('a', async () => {",
    '    assert.deepEqual(f(), { a: 1 })',
    '    assert.notEqual(f().a, 2)',
    '    assert(!(a || b))',
    '    assert.notContains([1], 2)',
    '    assert.throws(() => f(), /bad \\(x\\)/)',
    '    await assert.rejects(p, TypeError)',
    '    assert.equal(await p, 1)',
    '    const s = spy(() => 1)',
    '    assert.deepEqual(s.calls.at(-1)?.args, [1, 2])',
    '    // TODO(ubq): ubq has no toSatisfy. Write an assertion with assert,',
    '    // assert.equal, assert.deepEqual, or assert.match.',
    '    expect(f()).toSatisfy(ok)',
    '  })',
    "  // TODO(ubq): Give the reason: { skip: 'the reason' }.",
    "  test('b', { skip: 'TODO(ubq): the reason' }, () => {})",
    "  test('c', { timeout: 100 }, () => {})",
    '})',
  ])
})

test('node:test with require, jest with globals, and a file of no known tool', () => {
  const node = convert(
    `const { test, it } = require('node:test')
const assert = require('node:assert/strict')
it('a', (t) => {
  assert.strictEqual(1, 1, 'one')
  assert.ok(x)
  assert.rejects(p)
})
`,
    'a.cjs',
  )
  assert.deepEqual(node?.code, [
    "const { assert, test } = require('ubqtest')",
    "test('a', async () => {",
    '  assert.equal(1, 1) // one',
    '  assert(x)',
    '  await assert.rejects(p, Error)',
    '})',
  ])
  const jest = convert("describe('g', () => {\n  it('a', () => {\n    expect(1).toBe(1)\n  })\n})\n")
  assert.deepEqual(
    [jest?.framework, jest?.code[0], jest?.code[3]],
    ['jest', "import { assert, describe, test } from 'ubqtest'", '    assert.equal(1, 1)'],
  )
  assert.equal(convert("import { x } from './x.ts'\nx()\n"), undefined)
  assert.equal(
    convert("import { expect } from 'chai'\ndescribe('g', () => { it('a', () => { expect(1).to.equal(1) }) })\n"),
    undefined,
  )
})

test('the command changes the files, and the converted tests pass', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  const file = join(p.dir, 'old.ts')
  writeFileSync(
    file,
    `import t from 'tap'
import { parse, load } from './src/shape.js'

t.test('parse', t => {
  t.equal(parse('c')?.kind, 'circle')
  t.same(parse('s'), { kind: 'square', side: 2 }, 'a square')
  t.throws(() => parse('?'), RangeError)
  t.end()
})
t.test('load', async t => {
  t.rejects(load('x'), /no shape/)
  t.match(await load('s'), { kind: 'square' })
})
`,
  )
  const dry = p.ubq('convert', '--dry', 'old.ts')
  assert.deepEqual(dry.out.split('\n').slice(0, 2), [
    'to convert old.ts (tap): 9 changes, 0 TODO',
    'convert: 1 files to change, 0 TODO comments',
  ])
  assert.match(readFileSync(file, 'utf8'), /from 'tap'/)
  assert.deepEqual(p.ubq('convert', 'old.ts').out.split('\n'), [
    'converted old.ts (tap): 9 changes, 0 TODO',
    'convert: 1 files changed, 0 TODO comments',
    'note: 1 of these files have tests, and do not have a name that ubq runs (*.test.ts): old.ts. Rename them, or add to package.json: "ubq": { "include": ["old.ts"] }. Use "exclude" for files in that folder that are not test files.',
    'next: read `ubq guide convert`, do each TODO(ubq), then run: ubq',
    '',
  ])
  assert.equal(p.ubq('old.ts').last, 'pass: 0 failed, 2 passed')
  // A second conversion finds nothing to do.
  assert.equal(
    p.ubq('convert', 'old.ts').out,
    'convert: 0 files changed, 0 TODO comments, 1 files with no known test tool (old.ts)\n',
  )
  assert.deepEqual([p.ubq('convert').code, p.ubq('convert', 'nope').code], [4, 4])
  assert.match(p.ubq('guide', 'convert').out, /^# ubq guide: convert\n/)
  // A TypeScript file in a folder.
  mkdirSync(join(p.dir, 'spec'))
  writeFileSync(join(p.dir, 'spec/a.ts'), "import { expect, it } from 'vitest'\nit('a', () => expect(1).toBe(1))\n")
  assert.match(p.ubq('convert', '--dry', 'spec/a.ts').out, /"include": \["spec\/\*\*\/\*\.ts"\]/)
})

test('vitest: spy chains, calls of a spy, restore calls, and hooks that run one time', () => {
  const r = convert(`import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

afterEach(() => vi.restoreAllMocks())
afterEach(() => {
  vi.restoreAllMocks()
})
beforeAll(async () => { await migrate() })
afterAll(() => close())

describe('group', () => {
  beforeAll(async () => { await row() })
  it('a', () => {
    const f = vi.spyOn(globalThis, 'fetch').mockImplementation(impl)
    vi.spyOn(o, 'k').mockResolvedValue({ a: 1 })
    const g = vi.fn().mockRejectedValue(new Error('no'))
    expect(f.mock.calls[0]![0]).toBe('u')
    expect(f.mock.calls[1]?.[0]).toBe('u')
    expect(f.mock.calls.length).toBe(2)
    expect(f.mock.calls[0]).toEqual(['u'])
    expect(1.234).toBeCloseTo(1.23)
    expect(o).not.toHaveProperty('k')
    expect(o).toHaveProperty('a.b')
    vi.restoreAllMocks()
    expect(g.mock.calls.length).toBe(0)
    f.mockRestore()
  })
})
`)
  assert(r)
  // ubq has no vi, and a spy of ubq has no mockRestore: no call stays.
  const restored = (indent: string): string[] =>
    todo(
      'The convert command removed a call here that put spies back. A spyOn spy goes back when its test ends, not before, and a second spyOn on a key replaces the first. If the code after this place needs the real method, move that code to a new test.',
      indent,
    )
  assert.deepEqual(r.code, [
    "import { assert, describe, spy, spyOn, test } from 'ubqtest'",
    '',
    '{ await migrate() }',
    ...todo('ubq has no hooks. At the top level of the file, cleanup(fn) runs fn when the file ends.'),
    'afterAll(() => close())',
    '',
    "describe('group', () => {",
    ...todo(
      'ubq has no hooks. Make a function that does this work one time, and await it at the start of each test of the group: let ready; const setup = () => (ready ??= work()).',
      '  ',
    ),
    '  beforeAll(async () => { await row() })',
    "  test('a', () => {",
    "    const f = spyOn(globalThis, 'fetch', impl)",
    "    spyOn(o, 'k', async () => ({ a: 1 }))",
    "    const g = spy(async () => { throw new Error('no') })",
    "    assert.equal(f.calls[0]!.args[0], 'u')",
    "    assert.equal(f.calls[1]?.args?.[0], 'u')",
    '    assert.equal(f.calls.length, 2)',
    "    assert.deepEqual(f.calls[0].args, ['u'])",
    '    assert(Math.abs(1.234 - 1.23) < 0.005)',
    "    assert(!(Reflect.has(Object(o), 'k')))",
    ...todo(
      "toHaveProperty('a.b') is a path of keys: assert('b' in x.a). For one key with a dot in its name, assert('a.b' in x). Use assert(!(...)) for not.",
      '    ',
    ),
    "    expect(o).toHaveProperty('a.b')",
    ...restored('    '),
    '    assert.equal(g.calls.length, 0)',
    '  })',
    '})',
  ])
})

test('vitest: a wrapped subject stays wrapped, and a spy body that moves keeps its indent', () => {
  const r = convert(`import { expect, it, vi } from 'vitest'

it('a', async () => {
  const spy = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input, init) => {
      const req = new Request(input, init)
      return new Response(\`a
    b\`)
    })
  spy.mockRestore()
  expect(
    parsePatch('x'),
  ).toMatchObject([
    { path: 'e' },
  ])
  expect(
    await page.text(),
  ).toContain('hello')
})
`)
  assert(r)
  assert.deepEqual(r.code.slice(2), [
    "test('a', async () => {",
    "  const spy = spyOn(globalThis, 'fetch', async (input, init) => {",
    '    const req = new Request(input, init)',
    '    return new Response(`a',
    '    b`)',
    '  })',
    '  // TODO(ubq): The convert command removed a call here that put spies',
    '  // back. A spyOn spy goes back when its test ends, not before, and a',
    '  // second spyOn on a key replaces the first. If the code after this place',
    '  // needs the real method, move that code to a new test.',
    '  assert.match(',
    "    parsePatch('x'),",
    '    [',
    "      { path: 'e' },",
    '    ],',
    '  )',
    '  assert.contains(',
    '    await page.text(),',
    "    'hello',",
    '  )',
    '})',
  ])
})

test('vitest for Workers: the names of cloudflare:test', () => {
  const r =
    convert(`import { env, createExecutionContext, waitOnExecutionContext, createScheduledController, applyD1Migrations, SELF } from 'cloudflare:test'
import { expect, it } from 'vitest'
import worker from '../src/index'

it('responds', async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
  const ctx = createExecutionContext()
  const res = await worker.fetch(new Request('http://x/'), env, ctx)
  await waitOnExecutionContext(ctx)
  expect(res.status).toBe(200)
  await worker.scheduled(createScheduledController({ cron: '* * * * *' }), env, createExecutionContext())
})
`)
  assert(r)
  assert.deepEqual(r.code, [
    "// TODO(ubq): ubq has no 'cloudflare:test'. 'ubqtest/workers' has",
    '// executionContext, scheduledController, and migrate. Write the test',
    '// without the other names.',
    "import { env } from 'cloudflare:workers'",
    "import { executionContext, migrate, scheduledController } from 'ubqtest/workers'",
    "import { SELF } from 'cloudflare:test'",
    "import { assert, test } from 'ubqtest'",
    "import worker from '../src/index'",
    '',
    "test('responds', async () => {",
    "  await migrate('DB')",
    '  const ctx = executionContext()',
    "  const res = await worker.fetch(new Request('http://x/'), env, ctx)",
    '  await ctx.settled()',
    '  assert.equal(res.status, 200)',
    "  await worker.scheduled(scheduledController({ cron: '* * * * *' }), env, executionContext())",
    '})',
  ])
})

test('vitest: not.toMatch, expect.* matchers, toContain, and toThrow with a value', () => {
  const r = convert(`import { expect, it } from 'vitest'
it('a', () => {
  expect(text).not.toMatch(/re/)
  expect(row.tags).toContain('x')
  expect(rows[0]).toContain('x')
  expect(a?.b).toContain('x')
  expect(res.json()).toEqual({ count: expect.any(Number) })
  expect(last).toMatchObject({ content: expect.stringContaining('a.b') })
  expect(last).toMatchObject({ content: expect.not.stringContaining('c') })
  expect(() => f()).toThrow(message)
  expect(() => f()).toThrow(TypeError)
})
`)
  assert(r)
  assert.deepEqual(r.code, [
    "import { assert, test } from 'ubqtest'",
    "test('a', () => {",
    '  assert(!text.match(/re/))',
    "  assert.contains(row.tags, 'x')",
    "  assert.contains(rows[0], 'x')",
    "  assert.contains(a?.b, 'x')",
    ...todo(MATCHER, '  '),
    '  assert.deepEqual(res.json(), { count: expect.any(Number) })',
    '  assert.match(last, { content: /a\\.b/ })',
    ...todo(MATCHER, '  '),
    "  assert.match(last, { content: expect.not.stringContaining('c') })",
    '  // TODO(ubq): vitest and jest accept a string here. assert.throws needs',
    '  // an Error class, a RegExp, or a partial object. If this value is a',
    '  // string, make a RegExp from it.',
    '  assert.throws(() => f(), message)',
    '  assert.throws(() => f(), TypeError)',
    '})',
  ])
})

test('vitest: rejects, checks of many calls of one spy, optional chains, and stringContaining', () => {
  const r = convert(`import { expect, it, vi } from 'vitest'
it('a', async () => {
  const fn = vi.fn()
  expect(fn).toHaveBeenCalledWith('a')
  expect(fn).toHaveBeenCalledWith('b', call)
  expect(fn).toHaveBeenLastCalledWith('b')
  expect(a ?? b).toHaveBeenCalledWith()
  expect(a ?? b).toHaveBeenCalledWith(1)
  expect(other).toHaveBeenCalledWith('a')
  await expect(p).rejects.toBe(error)
  await expect(p).rejects.toBeInstanceOf(TypeError)
  expect(p).rejects.toMatchObject({ message: expect.stringContaining('x') })
  await expect(p).rejects.not.toBeInstanceOf(TypeError)
  expect(event.exception?.values).toHaveLength(2)
  expect(event.exception?.values).toContainEqual({ a: 1 })
  expect(fn).toHaveBeenLastCalledWith(expect.stringContaining('x'))
  expect(() => f()).toThrow(expect.stringContaining('x'))
  const made = vi.fn().mockReturnValue({ a: 1 } as T)
  expect((list[0]?.fn as Mock).mock.calls.length).toBe(1)
  expect(made).toHaveBeenCalledWith(call, entry, one)
  expect(made).toHaveBeenCalledWith(2)
})
it('b', () => {
  expect(fn).toHaveBeenCalledWith('a')
})
const part = expect.stringContaining('x')
expect(fn).toHaveBeenCalledWith('a')
`)
  assert(r)
  const rejects = todoComment(
    '  ',
    'assert.rejects gives the value that the promise rejects with: const error = await assert.rejects(promise, Error). Then assert on it: assert.equal(error, expected). The second argument is an error class, a RegExp for the message, or a partial object.',
  )
    .trimEnd()
    .split('\n')
  assert.deepEqual(r.code, [
    "import { assert, isDeepEqual, spy, test } from 'ubqtest'",
    "test('a', async () => {",
    '  const fn = spy()',
    // Two checks of one spy in one function: any call, as in vitest.
    "  assert(fn.calls.some(call => isDeepEqual(call.args, ['a'])))",
    // The arguments use the name `call`.
    "  assert(fn.calls.some(entry => isDeepEqual(entry.args, ['b', call])))",
    "  assert.deepEqual(fn.calls.at(-1)?.args, ['b'])",
    '  assert((a ?? b).calls.some(call => isDeepEqual(call.args, [])))',
    '  assert((a ?? b).calls.some(call => isDeepEqual(call.args, [1])))',
    // One check: the last call.
    "  assert.deepEqual(other.calls.at(-1)?.args, ['a'])",
    ...rejects,
    '  await expect(p).rejects.toBe(error)',
    '  await assert.rejects(p, TypeError)',
    '  await assert.rejects(p, { message: /x/ })',
    ...rejects,
    '  await expect(p).rejects.not.toBeInstanceOf(TypeError)',
    // Parentheses end an optional chain.
    '  assert.equal(event.exception?.values.length, 2)',
    '  assert(event.exception?.values.some(item => isDeepEqual(item, { a: 1 })))',
    // A RegExp tests a string only in a pattern.
    ...todo(MATCHER, '  '),
    "  assert.deepEqual(fn.calls.at(-1)?.args, [expect.stringContaining('x')])",
    '  assert.throws(() => f(), /x/)',
    // An object with a cast is an object, not a block.
    '  const made = spy(() => ({ a: 1 } as T))',
    // The `)` of a cast stays.
    '  assert.equal((list[0]?.fn as Mock).calls.length, 1)',
    // The arguments use each name for the call.
    '  assert(made.calls.some(_call => isDeepEqual(_call.args, [call, entry, one])))',
    '  assert(made.calls.some(call => isDeepEqual(call.args, [2])))',
    '})',
    "test('b', () => {",
    "  assert.deepEqual(fn.calls.at(-1)?.args, ['a'])",
    '})',
    // Not in the arguments of a matcher.
    ...todoComment('', MATCHER).trimEnd().split('\n'),
    "const part = expect.stringContaining('x')",
    // Code that is in no function: the checks of the whole file count.
    "assert(fn.calls.some(call => isDeepEqual(call.args, ['a'])))",
  ])
})

test('vitest: the converted checks of rejects, of many calls, and of an optional chain pass', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  writeFileSync(
    join(p.dir, 'old.ts'),
    `import { expect, it, vi } from 'vitest'
it('a', async () => {
  const fn = vi.fn()
  fn('a')
  fn('b')
  expect(fn).toHaveBeenCalledWith('a')
  expect(fn).toHaveBeenCalledWith('b')
  const fail = () => Promise.reject(new TypeError('no x'))
  await expect(fail()).rejects.toBeInstanceOf(TypeError)
  await expect(fail()).rejects.toMatchObject({ message: expect.stringContaining('x') })
  const event: { list?: number[] } = { list: [1, 2] }
  expect(event?.list).toHaveLength(2)
})
`,
  )
  assert.equal(p.ubq('convert', 'old.ts').out.split('\n')[0], 'converted old.ts (vitest): 9 changes, 0 TODO')
  assert.equal(p.ubq('old.ts').last, 'pass: 0 failed, 1 passed')
})

test('vitest: other names of matchers, the nth call, exactly one call, typeof, and the hints', () => {
  const r = convert(`import { describe, expect, it, vi } from 'vitest'
it('a', () => {
  expect(s).toBeCalled()
  expect(s).toBeCalledTimes(2)
  expect(s).lastCalledWith(1)
  expect(s).toHaveBeenNthCalledWith(2, 'b', 3)
  expect(s).nthCalledWith(1)
  expect(s).toHaveBeenNthCalledWith(n, 1)
  expect(s).toHaveBeenCalledExactlyOnceWith('a')
  expect(s()).toHaveBeenCalledExactlyOnceWith('a')
  expect(s).not.toHaveBeenCalled()
  expect(s).not.toBeCalledWith(1, 2)
  expect(x).toBeTypeOf('string')
  expect(x).not.toBeTypeOf('number')
  expect(() => f()).not.toThrow()
  expect(x).toMatchInlineSnapshot('1')
  expect.assertions(2)
  s.mockClear()
  vi.clearAllMocks()
  vi.useRealTimers()
  vi.waitFor(() => 1)
  vi.stubEnv('A', '1')
  vi.getTimerCount()
})
describe.each([1])('g %s', n => {})
it.skipIf(a)('b', () => {})
describe.runIf(a)('c', () => {})
`)
  assert(r)
  assert.deepEqual(r.code, [
    "import { assert, describe, isDeepEqual, test } from 'ubqtest'",
    "test('a', () => {",
    '  assert(s.calls.length > 0)',
    '  assert.equal(s.calls.length, 2)',
    '  assert.deepEqual(s.calls.at(-1)?.args, [1])',
    "  assert.deepEqual(s.calls[1]?.args, ['b', 3])",
    '  assert.deepEqual(s.calls[0]?.args, [])',
    // The index is not a number in the code.
    ...todo(
      'ubq has no toHaveBeenNthCalledWith. Write an assertion with assert, assert.equal, assert.deepEqual, or assert.match.',
      '  ',
    ),
    '  expect(s).toHaveBeenNthCalledWith(n, 1)',
    '  assert.equal(s.calls.length, 1)',
    "  assert.deepEqual(s.calls[0]?.args, ['a'])",
    // The subject would run two times.
    ...todo(
      'ubq has no toHaveBeenCalledExactlyOnceWith. Write an assertion with assert, assert.equal, assert.deepEqual, or assert.match.',
      '  ',
    ),
    "  expect(s()).toHaveBeenCalledExactlyOnceWith('a')",
    '  assert.equal(s.calls.length, 0)',
    '  assert(!s.calls.some(call => isDeepEqual(call.args, [1, 2])))',
    "  assert.equal(typeof x, 'string')",
    "  assert.notEqual(typeof x, 'number')",
    ...todo(
      'Call the function, then assert on its result. For a function with no result, assert on what it changed, or on the calls of a spy.',
      '  ',
    ),
    '  expect(() => f()).not.toThrow()',
    ...todo(
      'ubq has no inline snapshot. For a string, compare it with the text: assert.equal(value, `text`). For another value: assert.snapshot(value), then ubq --update <file>, and check that the new snapshot has the old text.',
      '  ',
    ),
    "  expect(x).toMatchInlineSnapshot('1')",
    ...todo(
      'Delete this call. A test with no assertion fails in ubq. If an assertion is in a callback, make the test wait for the callback: await a promise, then assert on the values that the callback got.',
      '  ',
    ),
    '  expect.assertions(2)',
    ...todo(
      'To forget the calls of a spy: s.calls.length = 0. A spy that a test makes has no calls from other tests: then delete this call.',
      '  ',
    ),
    '  s.mockClear()',
    ...todo(
      'To forget the calls of a spy: s.calls.length = 0. A spy that a test makes has no calls from other tests: then delete this call.',
      '  ',
    ),
    '  vi.clearAllMocks()',
    ...todo(
      'Delete this call. The clock of fakeClock() ends when its test ends. To end it before that: clock.restore().',
      '  ',
    ),
    '  vi.useRealTimers()',
    ...todo(
      'Use await assert.eventually(() => value, pattern). It calls the function until its value matches the pattern, for 2000 ms at most.',
      '  ',
    ),
    '  vi.waitFor(() => 1)',
    ...todo("Use env({ NAME: 'value' }). It puts the variable back when the test ends.", '  '),
    "  vi.stubEnv('A', '1')",
    ...todo(
      'Use fakeClock: const clock = fakeClock(), then await clock.tick(ms). The clock ends when its test ends.',
      '  ',
    ),
    '  vi.getTimerCount()',
    '})',
    ...todo(
      'Use a for loop around describe(). Each name must be different: put the value or the index in the name. Use JSON.stringify for an object.',
    ),
    "describe.each([1])('g %s', n => {})",
    ...todo("Use an option of test(): { skip: condition && 'the reason' }."),
    "it.skipIf(a)('b', () => {})",
    ...todo("Use an option of describe(): { skip: !condition && 'the reason' }."),
    "describe.runIf(a)('c', () => {})",
  ])
})

test('vitest: the converted forms of the calls of a spy pass', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  writeFileSync(
    join(p.dir, 'old.ts'),
    `import { expect, it, vi } from 'vitest'
it('a', () => {
  const s = vi.fn()
  const never = vi.fn()
  s('a', 1)
  s('b')
  expect(s).toBeCalled()
  expect(s).toBeCalledTimes(2)
  expect(s).toHaveBeenNthCalledWith(1, 'a', 1)
  expect(s).nthCalledWith(2, 'b')
  expect(s).not.toBeCalledWith('c')
  expect(never).not.toHaveBeenCalled()
  never('x')
  expect(never).toHaveBeenCalledExactlyOnceWith('x')
  const one = vi.fn()
  one()
  expect(one).toHaveBeenCalledExactlyOnceWith()
  expect('t').toBeTypeOf('string')
  expect(1).not.toBeTypeOf('string')
})
`,
  )
  assert.equal(p.ubq('convert', 'old.ts').out.split('\n')[0], 'converted old.ts (vitest): 15 changes, 0 TODO')
  assert.equal(p.ubq('old.ts').last, 'pass: 0 failed, 1 passed')
})

test('vitest: a spy of a module namespace, and a spy assertion on a real import', () => {
  const r = convert(`import { expect, it, vi } from 'vitest'
import * as time from '../src/time'
import { now } from '../src/time'
import { send } from '../src/send'
import { read } from '../src/read'
import { helper } from './helper'
import { debug } from '../src/debug'

vi.mock('../src/send')
it('a', () => {
  vi.spyOn(time, 'now').mockReturnValue(1)
  const s = vi.spyOn(time, key)
  vi.spyOn(debug, 'error')
  expect(now).toHaveBeenCalledTimes(1)
  expect(time.now).toHaveBeenCalledWith(2)
  expect(send).toHaveBeenCalled()
  expect(read).toHaveBeenCalled()
  expect(helper.fn).toHaveBeenCalled()
  expect(s).toHaveBeenCalled()
  expect(now).toBe(time.now)
})
`)
  assert(r)
  const real = (name: string): string[] =>
    todoComment(
      '  ',
      `${name} is the real export of its module, not a spy. Make a spy, give it to mockImport in place of the export, and assert on that spy.`,
    )
      .trimEnd()
      .split('\n')
  const namespace = (key: string): string[] =>
    todoComment(
      '  ',
      `spyOn cannot replace an export of a module: time is the module '../src/time', and the code under test has its own import of it. Use mockImport: const subject = await mockImport(() => import('<the module under test>'), [[() => import('../src/time'), { ...time, ${key}: spy(impl) }]]). Then call the code of subject, not of the import at the top of the file, and assert on the spy.`,
    )
      .trimEnd()
      .split('\n')
  assert.deepEqual(r.code.slice(r.code.indexOf("test('a', () => {") + 1, -1), [
    // The call stays as it is: the name `vi` has no import now.
    ...namespace('now'),
    "  vi.spyOn(time, 'now').mockReturnValue(1)",
    ...namespace('name'),
    '  const s = vi.spyOn(time, key)',
    // An object that is not a module.
    "  spyOn(debug, 'error')",
    ...real('now'),
    '  assert.equal(now.calls.length, 1)',
    ...real('time.now'),
    '  assert.deepEqual(time.now.calls.at(-1)?.args, [2])',
    // The file replaces the module with vi.mock.
    ...real('send'),
    '  assert(send.calls.length > 0)',
    // A module that the file does not replace can export a spy.
    '  assert(read.calls.length > 0)',
    '  assert(helper.fn.calls.length > 0)',
    '  assert(s.calls.length > 0)',
    '  assert.equal(now, time.now)',
  ])
  assert.equal(r.code[0], "import { assert, spyOn, test } from 'ubqtest'")
})

test('vitest: a hook at the top level that uses a later name, a restore hook, and resolves', () => {
  const r = convert(`import { afterEach, beforeAll, expect, it } from 'vitest'

let restore = () => {}
afterEach(() => restore())
beforeAll(async () => {
  await insert(repo)
})
beforeAll(() => {
  const local = [1].map(n => { return n })
  use(local)
})
const repo = 'a/b'

it('a', async () => {
  await expect(load()).resolves.toBeDefined()
  expect(value).toBeDefined()
})
`)
  assert(r)
  assert.deepEqual(r.code, [
    "import { assert, test } from 'ubqtest'",
    '',
    'let restore = () => {}',
    '// TODO(ubq): If this only puts spies back, delete it, each assignment to',
    '// restore, and each call of restore() or of the function that was',
    '// assigned. Then remove that function from the helper that gives it. A',
    '// spyOn spy goes back when its test ends, and a second spyOn on a key',
    '// replaces the first. If it does other work: ubq has no hooks. Make a',
    '// setup function and call it in each test. Use cleanup() for the work',
    '// after a test.',
    'afterEach(() => restore())',
    '// TODO(ubq): ubq has no hooks. Put this code at the top level of the file,',
    '// with await. It runs at this place, not later: put it after the',
    '// declarations that it uses.',
    'beforeAll(async () => {',
    '  await insert(repo)',
    '})',
    '{',
    '  const local = [1].map(n => { return n })',
    '  use(local)',
    '}',
    "const repo = 'a/b'",
    '',
    "test('a', async () => {",
    '  assert((await load()) !== undefined)',
    '  assert(value !== undefined)',
    '})',
  ])
})

test('a project of the vitest plugin for Workers: the workers key and the migrations', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  mkdirSync(join(p.dir, 'worker/test'), { recursive: true })
  mkdirSync(join(p.dir, 'second/test'), { recursive: true })
  writeFileSync(
    join(p.dir, 'vitest.config.ts'),
    `import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: './worker/wrangler.jsonc' },
            miniflare: {
              bindings: { APP_ID: '12345', LIMIT: 3, FLAGS: { a: true }, TEST_MIGRATIONS: await readD1Migrations('migrations'), SECRET: process.env.X },
            },
          }),
        ],
        test: { include: ['worker/test/**/*.test.ts'], setupFiles: ['./worker/test/setup.ts'] },
      },
      {
        plugins: [cloudflareTest({ wrangler: { configPath: './second/wrangler.test.jsonc' } })],
        test: { include: ['second/test/**/*.test.ts'], setupFiles: './second/test/setup.ts' },
      },
    ],
  },
})
`,
  )
  writeFileSync(
    join(p.dir, 'worker/test/setup.ts'),
    "import { applyD1Migrations, env } from 'cloudflare:test'\n\n// Before each test file.\nawait applyD1Migrations(env.DB, env.TEST_MIGRATIONS)\n",
  )
  writeFileSync(join(p.dir, 'second/test/setup.ts'), 'globalThis.x = 1\n')
  const old = "import { expect, it } from 'vitest'\n\nit('a', () => {\n  expect(1).toBe(1)\n})\n"
  writeFileSync(join(p.dir, 'worker/test/a.test.ts'), old)
  writeFileSync(join(p.dir, 'second/test/b.test.ts'), old)
  const workers = [
    {
      config: 'worker/wrangler.jsonc',
      include: ['worker/test/**/*.test.ts'],
      vars: { APP_ID: '12345', LIMIT: 3, FLAGS: { a: true } },
    },
    { config: 'second/wrangler.test.jsonc', include: ['second/test/**/*.test.ts'] },
  ]
  // doctor says that the conversion writes the key. It is a note,
  // not a problem.
  writeFileSync(join(p.dir, 'worker/test/a.test.ts'), "import { env } from 'cloudflare:test'\n" + old)
  const doctor = p.ubq('doctor')
  assert.match(
    doctor.out,
    /\nnote this project has tests of a Cloudflare Worker .* Do not add it by hand: "ubq convert" writes it to package\.json, from vitest\.config\.ts\.\n/,
  )
  assert.notContains(doctor.out, 'FIX  this project has tests of a Cloudflare Worker')
  writeFileSync(join(p.dir, 'worker/test/a.test.ts'), old)

  assert.deepEqual(p.ubq('convert', 'worker', 'second').out.split('\n').slice(2, -2), [
    'convert: 2 files changed, 0 TODO comments, 2 files with no known test tool (second/test/setup.ts, worker/test/setup.ts)',
    'note: second/test/setup.ts is a setup file of vitest.config.ts. ubq has no setup files. Export its work as a function, and await that function at the top level of each test file. See "A Cloudflare Worker" in: ubq guide convert',
    'note: each test file now applies the D1 migrations (await migrate(...)). The setup file is not necessary: remove worker/test/setup.ts.',
    `wrote "ubq.workers" to package.json, from vitest.config.ts: "workers": ${JSON.stringify(workers)}`,
    'note: the binding SECRET of miniflare.bindings in vitest.config.ts is not a plain value. Add it to "vars" by hand.',
    'note: second/wrangler.test.jsonc has "test" in its name. If it is a copy of the wrangler config of the Worker that exists only to leave out "containers" or a service binding, it is not necessary: ubq loads a config with them. Then give the config of the Worker in "config", and remove the copy.',
  ])
  assert.deepEqual(JSON.parse(readFileSync(join(p.dir, 'package.json'), 'utf8')).ubq, { workers })
  assert.deepEqual(readFileSync(join(p.dir, 'worker/test/a.test.ts'), 'utf8').split('\n').slice(0, 4), [
    "import { assert, test } from 'ubqtest'",
    "import { migrate } from 'ubqtest/workers'",
    '',
    "await migrate('DB')",
  ])
  assert.equal(
    readFileSync(join(p.dir, 'second/test/b.test.ts'), 'utf8').split('\n')[0],
    "import { assert, test } from 'ubqtest'",
  )
  assert(!readFileSync(join(p.dir, 'second/test/b.test.ts'), 'utf8').includes('migrate'))
})

test('vitest: toContainEqual', () => {
  const r = convert(`import { expect, it } from 'vitest'
it('a', () => {
  expect(list).toContainEqual({ contents: 'write' })
  expect(list).not.toContainEqual(item)
})
`)
  assert(r)
  assert.deepEqual(r.code, [
    "import { assert, isDeepEqual, test } from 'ubqtest'",
    "test('a', () => {",
    "  assert(list.some(item => isDeepEqual(item, { contents: 'write' })))",
    '  assert(!(list.some(element => isDeepEqual(element, item))))',
    '})',
  ])
})

test('the report of the command: a number for each hint, and the text of a hint one time', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  mkdirSync(join(p.dir, 'old'))
  writeFileSync(
    join(p.dir, 'old/a.test.ts'),
    `import { beforeEach, expect, it } from 'vitest'
beforeEach(() => reset())
it.skip('a', () => {})
beforeEach(() => again())
`,
  )
  // A helper with no tests: its name is not a problem.
  writeFileSync(join(p.dir, 'old/helper.ts'), "import { vi } from 'vitest'\nexport const fake = () => vi.fn()\n")
  assert.deepEqual(p.ubq('convert', '--dry', 'old').out.split('\n'), [
    'to convert old/a.test.ts (vitest): 2 changes, 3 TODO',
    '  old/a.test.ts:2  [1] ubq has no hooks.',
    '  old/a.test.ts:5  [2] Give the reason:',
    '  old/a.test.ts:7  [1] ubq has no hooks.',
    'to convert old/helper.ts (vitest): 2 changes, 0 TODO',
    'hints:',
    '  [1] ubq has no hooks. Make a setup function and call it in each test. Use cleanup() for the work after a test.',
    "  [2] Give the reason: { skip: 'the reason' }.",
    'convert: 2 files to change, 3 TODO comments',
    'note: this command makes only the changes that are correct in each case. A TODO can be easy to do by hand: the command leaves it if the change is not safe for each program that has that form.',
    'next: read `ubq guide convert`, do each TODO(ubq), then run: ubq',
    '',
  ])
})

test('the report names the files that still name the old tool, and the command of the formatter', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  mkdirSync(join(p.dir, 'old'))
  writeFileSync(join(p.dir, 'old/a.test.ts'), "import { expect, it } from 'vitest'\nit('a', () => expect(1).toBe(1))\n")
  writeFileSync(
    join(p.dir, 'old/env.d.ts'),
    "import type { D1Migration } from '@cloudflare/vitest-pool-workers'\nexport type M = D1Migration\n",
  )
  writeFileSync(join(p.dir, 'old/setup.ts'), "import 'jest'\n")
  writeFileSync(join(p.dir, 'old/other.d.ts'), 'export type N = number\n')
  // ubq has no SELF: the import stays, with a TODO.
  writeFileSync(
    join(p.dir, 'old/w.test.ts'),
    "import { SELF } from 'cloudflare:test'\nimport { it } from 'vitest'\nit('a', () => SELF)\n",
  )
  // The command does not look in node_modules.
  mkdirSync(join(p.dir, 'old/node_modules/x'), { recursive: true })
  writeFileSync(join(p.dir, 'old/node_modules/x/index.d.ts'), "import 'vitest'\n")
  writeFileSync(join(p.dir, 'package.json'), JSON.stringify({ type: 'module', devDependencies: { prettier: '3' } }))
  const notes = (...args: string[]): string[] =>
    p
      .ubq('convert', ...args)
      .out.split('\n')
      .filter(line => /^note: (these|this command does not)/.test(line))
  const old =
    'note: these files still name the old test tool: old/env.d.ts, old/setup.ts, old/w.test.ts. Change them before you remove that tool.'
  // With --dry, no file changes: there is nothing to format.
  assert.deepEqual(notes('--dry', 'old'), [old])
  assert.deepEqual(notes('old'), [
    old,
    'note: this command does not format the code. To format the changed files: npx prettier --write old/a.test.ts old/w.test.ts',
  ])
})

test('the report names c8 and istanbul comments, and a file with only top-level assertions', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  spawnSync('git', ['init', '-q'], { cwd: p.dir })
  mkdirSync(join(p.dir, 'src'), { recursive: true })
  mkdirSync(join(p.dir, 'old'))
  mkdirSync(join(p.dir, 'dist'))
  writeFileSync(
    join(p.dir, 'src/a.ts'),
    [
      '/* c8 ignore start */',
      'a()',
      '/* c8 ignore stop */',
      '// istanbul ignore next',
      'b()',
      '/* v8 ignore next */',
      '/* c8 ignore next */',
      '/* istanbul ignore else */',
      '/* c8 ignore next 2 */',
      '',
    ].join('\n'),
  )
  // git ignores dist, and does not have the file that is gone.
  writeFileSync(join(p.dir, '.gitignore'), 'dist\n')
  writeFileSync(join(p.dir, 'dist/a.js'), '/* c8 ignore next */\n')
  writeFileSync(join(p.dir, 'src/gone.ts'), '/* c8 ignore next */\n')
  spawnSync('git', ['add', 'src/gone.ts'], { cwd: p.dir })
  rmSync(join(p.dir, 'src/gone.ts'))
  writeFileSync(join(p.dir, 'old/top.ts'), "import t from 'tap'\n\nt.equal(1, 1)\n")
  assert.deepEqual(
    p
      .ubq('convert', '--dry', 'old')
      .out.split('\n')
      .filter(line => line.startsWith('note: 1 of') || line.startsWith('note: ubq does not')),
    [
      'note: 1 of these files have tests, and do not have a name that ubq runs (*.test.ts): old/top.ts. Rename them, or add to package.json: "ubq": { "include": ["old/**/*.ts"] }. Use "exclude" for files in that folder that are not test files.',
      'note: ubq does not read c8 or istanbul ignore comments: src/a.ts:1, src/a.ts:4, src/a.ts:6, src/a.ts:7, src/a.ts:8, and 1 more. At each range that no test can run, write: // ubq: not measured: <reason>',
    ],
  )
})

test(
  'the parser reads type syntax that it does not know, with the types removed',
  { skip: !!process.versions.bun && 'Bun has no function that removes types' },
  () => {
    // A `const` type parameter in an interface is an error for the parser.
    const source = 'interface A {\n  m<const T>(a: T): void\n}\nexport const f = (a: number): number => a + 1\n'
    const tree = parse(source, 'a.ts')
    // The positions are those of the source.
    const last = (tree.body as { start: number; end: number }[]).at(-1)!
    assert.equal(source.slice(last.start, last.end), 'export const f = (a: number): number => a + 1')
    assert.throws(() => parse('const = 1', 'a.ts'), SyntaxError)
  },
)

test('a file with no line end at its end, and a file of one line', () => {
  assert.deepEqual(
    convert(
      "import assert from 'node:assert'\nimport { test } from 'node:test'\ntest('a', () => {\n  assert.ok(1)\n})\nassert.ok(2, 'last')",
    )?.code,
    [
      "import { assert, test } from 'ubqtest'",
      "test('a', () => {",
      '  assert(1)',
      '})',
      '// TODO(ubq): ubq needs each assertion in a test. Put this in a test().',
      'assert(2) // last',
    ],
  )
  assert.deepEqual(convert("import t from 'tap'\nt.test('a', t => {\n  t.pass()\n})\nt.end()")?.code, [
    "import { assert, test } from 'ubqtest'",
    "test('a', () => {",
    '  assert(true)',
    '})',
  ])
  assert.deepEqual(convert("import { it, expect } from 'vitest'; it('a', () => { expect(1).toBe(1) })")?.code, [
    "import { assert, test } from 'ubqtest'; test('a', () => { assert.equal(1, 1) })",
  ])
})

test('the report of the command for files that it cannot change, and for many files', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  for (const dir of ['old', 'old/deep', 'plain']) mkdirSync(join(p.dir, dir))
  // The parser cannot read this file.
  writeFileSync(join(p.dir, 'old/bad.test.js'), "import { it } from 'vitest'\nit('a', () => {\n")
  // Tests in files with a name that ubq does not run.
  for (const n of [1, 2, 3, 4, 5, 6])
    writeFileSync(
      join(p.dir, `old/deep/spec${n}.js`),
      "import { it, expect } from 'vitest'\nit('a', () => {\n  expect(1).toBe(1)\n})\n",
    )
  // Files with no test tool.
  for (let n = 0; n < 11; n++)
    writeFileSync(join(p.dir, `plain/file${String(n).padStart(2, '0')}.js`), 'export const x = 1\n')
  const lines = p.ubq('convert', '--dry', 'old', 'plain').out.split('\n')
  assert.match(lines[0]!, /^not converted old\/bad\.test\.js: /)
  assert.deepEqual(lines.slice(-4), [
    'convert: 6 files to change, 0 TODO comments, 1 files not converted (see the lines above), 11 files with no known test tool (plain/file00.js, plain/file01.js, plain/file02.js, plain/file03.js, plain/file04.js, plain/file05.js, plain/file06.js, plain/file07.js, plain/file08.js, plain/file09.js, and 1 more)',
    'note: 6 of these files have tests, and do not have a name that ubq runs (*.test.ts): old/deep/spec1.js, old/deep/spec2.js, old/deep/spec3.js, old/deep/spec4.js, old/deep/spec5.js, .... Rename them, or add to package.json: "ubq": { "include": ["old/**/*.js"] }. Use "exclude" for files in that folder that are not test files.',
    'next: read `ubq guide convert`, do each TODO(ubq), then run: ubq',
    '',
  ])
})

test('a Workers project with no vitest config, and one whose package.json is not JSON', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  const old =
    "import { env } from 'cloudflare:test'\nimport { expect, it } from 'vitest'\nit('a', () => {\n  expect(env).toBeTruthy()\n})\n"
  writeFileSync(join(p.dir, 'w.test.ts'), old)
  assert.match(
    p.ubq('convert', '--dry', 'w.test.ts').out,
    /\nnote: 1 of these files are tests of a Cloudflare Worker\. They must run in the Workers runtime\. Add to package\.json: "ubq": \{ "workers": /,
  )
  // A vitest config whose setup file is not there, and a package.json that the command cannot write.
  writeFileSync(
    join(p.dir, 'vitest.config.ts'),
    "export default { plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })], test: { include: ['*.test.ts'], setupFiles: ['./gone.ts'] } }\n",
  )
  writeFileSync(join(p.dir, 'package.json'), '{ "type": "module", // a comment\n}')
  const key = '"workers": [{"config":"wrangler.jsonc","include":["*.test.ts"]}]'
  assert(p.ubq('convert', 'w.test.ts').out.includes(`\nadd to "ubq" in package.json, from vitest.config.ts: ${key}\n`))
})

test('tap: the scripts test and snap of package.json become ubq and ubq --update', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  mkdirSync(join(p.dir, 'test'))
  writeFileSync(join(p.dir, 'test/a.test.ts'), "import t from 'tap'\nt.equal(1, 1)\n")
  const pkg = (scripts: Record<string, string>) =>
    writeFileSync(join(p.dir, 'package.json'), JSON.stringify({ type: 'module', scripts }, null, 2) + '\n')
  const scripts = () =>
    (JSON.parse(readFileSync(join(p.dir, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts
  const line = 'changed the scripts of package.json: "test": "ubq", "snap": "ubq --update"'

  // --dry changes no file.
  pkg({ lint: 'eslint', test: 'tap', snap: 'tap' })
  assert(
    p
      .ubq('convert', '--dry', 'test')
      .out.includes(`\nto change the scripts of package.json: "test": "ubq", "snap": "ubq --update"\n`),
  )
  assert.deepEqual(scripts(), { lint: 'eslint', test: 'tap', snap: 'tap' })
  assert(p.ubq('convert', 'test').out.includes(`\n${line}\n`))
  assert.deepEqual(Object.entries(scripts()), [
    ['lint', 'eslint'],
    ['test', 'ubq'],
    ['snap', 'ubq --update'],
  ])
  // The name snapshot, and both names.
  writeFileSync(join(p.dir, 'test/a.test.ts'), "import t from 'tap'\nt.equal(1, 1)\n")
  pkg({ test: 'tap', snapshot: 'tap', snap: 'tap' })
  assert(
    p
      .ubq('convert', 'test')
      .out.includes(
        '\nchanged the scripts of package.json: "test": "ubq", "snap": "ubq --update", "snapshot": "ubq --update"\n',
      ),
  )
  assert.deepEqual(scripts(), { test: 'ubq', snapshot: 'ubq --update', snap: 'ubq --update' })
  // Scripts with other commands do not change.
  writeFileSync(join(p.dir, 'test/a.test.ts'), "import t from 'tap'\nt.equal(1, 1)\n")
  pkg({ test: 'tap --coverage-report=text', snap: 'tap' })
  assert(!p.ubq('convert', 'test').out.includes('package.json'))
  assert.deepEqual(scripts(), { test: 'tap --coverage-report=text', snap: 'tap' })
  // A package.json that is not JSON.
  writeFileSync(join(p.dir, 'test/a.test.ts'), "import t from 'tap'\nt.equal(1, 1)\n")
  writeFileSync(join(p.dir, 'package.json'), '{ not json')
  assert.equal(p.ubq('convert', 'test').code, 0)
})

test('a helper that gives a restore function: the hook, the variable, and the assignments go', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  mkdirSync(join(p.dir, 'old'))
  const write = (file: string, lines: string[]): void =>
    writeFileSync(join(p.dir, 'old', file), lines.join('\n') + '\n')
  const read = (file: string): string[] =>
    readFileSync(join(p.dir, 'old', file), 'utf8')
      .split('\n')
      .slice(0, -1)
  write('helper.ts', [
    "import { vi } from 'vitest'",
    'export const mockFetch = (fn: any) => {',
    '  const calls: unknown[] = []',
    "  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(fn)",
    '  return {',
    '    calls,',
    '    restore: () => spy.mockRestore(),',
    '    size: () => calls.length,',
    '    reset: () => {},',
    '  }',
    '}',
    'export type Calls = unknown[]',
    'export function mockLog() {',
    "  const spy = vi.spyOn(console, 'log')",
    '  return { restore: () => { spy.mockRestore() }, spy }',
    '}',
    "export const mockWarn = () => ({ restore: () => vi.spyOn(console, 'warn').mockRestore(), n: 1 })",
    "export const mockError = () => ({ n: 2, restore: () => vi.spyOn(console, 'error').mockRestore() })",
  ])
  // A file that exports a helper again: code outside the run can use it.
  write('helper2.ts', [
    "import { vi } from 'vitest'",
    "export const mockTime = () => ({ restore: () => vi.spyOn(Date, 'now').mockRestore() })",
  ])
  write('index.ts', ["export * from './helper2.ts'"])
  // A test file that only assigns the functions: all of it goes.
  write('a.test.ts', [
    "import { afterEach, expect, it } from 'vitest'",
    "import { mockError, mockFetch, mockLog, mockWarn } from './helper.js'",
    "import { mockTime } from './helper2.ts'",
    'let restore = () => {}',
    'afterEach(() => restore())',
    "it('a', async () => {",
    "  const m = mockFetch(() => new Response('ok'))",
    '  restore = m.restore',
    '  expect(m.calls).toEqual([])',
    '})',
    "it('b', async () => {",
    '  const l = await mockLog()',
    '  restore = l.restore',
    '  const w = mockWarn()',
    '  restore = w.restore',
    '  const e = mockError()',
    '  restore = e.restore',
    '  const t = mockTime()',
    '  restore = t.restore',
    '})',
  ])
  // A call in a test: the function of mockLog stays.
  write('b.test.ts', [
    "import { afterEach, it } from 'vitest'",
    "import { mockLog } from './helper.ts'",
    'let undo: (() => void) | undefined',
    'afterEach(() => undo?.())',
    "it('c', () => {",
    '  const l = mockLog()',
    '  undo = l.restore',
    '  l.restore()',
    '  mockLog()',
    '  const f = mockLog',
    '  use(l)',
    '})',
  ])
  // A name that is also an other value: the hook stays.
  write('d.test.ts', [
    "import { afterEach, it } from 'vitest'",
    "import { mockLog } from './helper.ts'",
    'let restore = () => {}',
    'afterEach(() => restore())',
    "it('e', () => {",
    '  const l = mockLog()',
    '  restore = l.restore',
    '})',
    "it('f', () => {",
    '  const l = 2',
    '})',
  ])
  // A function that does other work: the hook stays, with a TODO.
  write('c.test.ts', [
    "import { afterEach, it } from 'vitest'",
    'let restore = () => {}',
    'afterEach(() => restore())',
    'afterEach(cleanupAll)',
    'afterEach(() => { x = 1 })',
    'afterEach(() => spy.mockRestore())',
    "it('d', () => {",
    '  restore = () => server.close()',
    '  restore = a.b.restore',
    '})',
  ])
  p.ubq('convert', 'old')
  assert.deepEqual(read('helper.ts'), [
    "import { spyOn } from 'ubqtest'",
    'export const mockFetch = (fn: any) => {',
    '  const calls: unknown[] = []',
    "  const spy = spyOn(globalThis, 'fetch', fn)",
    '  return {',
    '    calls,',
    '    size: () => calls.length,',
    '    reset: () => {},',
    '  }',
    '}',
    'export type Calls = unknown[]',
    'export function mockLog() {',
    "  const spy = spyOn(console, 'log')",
    '  // TODO(ubq): A spyOn spy goes back when its test ends. Remove this call,',
    '  // if the code after it does not need the real method: a second spyOn on',
    '  // a key replaces the first. ubq has no call that puts the method back',
    '  // before the test ends. The callers of the helper get this function as',
    '  // "restore". In the test files, remove each call and each assignment of',
    '  // it, and each hook that only calls it. Then remove this function.',
    '  return { restore: () => { spy.mockRestore() }, spy }',
    '}',
    'export const mockWarn = () => ({ n: 1 })',
    'export const mockError = () => ({ n: 2 })',
  ])
  assert.deepEqual(read('helper2.ts').slice(1, 2), [
    '// TODO(ubq): A spyOn spy goes back when its test ends. Remove this call,',
  ])
  assert.deepEqual(read('a.test.ts'), [
    "import { assert, test } from 'ubqtest'",
    "import { mockError, mockFetch, mockLog, mockWarn } from './helper.js'",
    "import { mockTime } from './helper2.ts'",
    "test('a', async () => {",
    "  const m = mockFetch(() => new Response('ok'))",
    '  assert.deepEqual(m.calls, [])',
    '})',
    "test('b', async () => {",
    '  const l = await mockLog()',
    '  const w = mockWarn()',
    '  const e = mockError()',
    '  const t = mockTime()',
    '})',
  ])
  assert.deepEqual(read('b.test.ts'), [
    "import { test } from 'ubqtest'",
    "import { mockLog } from './helper.ts'",
    "test('c', () => {",
    '  const l = mockLog()',
    '  l.restore()',
    '  mockLog()',
    '  const f = mockLog',
    '  use(l)',
    '})',
  ])
  assert.deepEqual(read('d.test.ts').slice(2, 4), [
    'let restore = () => {}',
    '// TODO(ubq): If this only puts spies back, delete it, each assignment to',
  ])
  assert.deepEqual(read('c.test.ts').slice(0, 3), [
    "import { test } from 'ubqtest'",
    'let restore = () => {}',
    '// TODO(ubq): If this only puts spies back, delete it, each assignment to',
  ])
})
