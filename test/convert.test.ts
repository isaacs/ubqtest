// `ubq convert`: test files of a different test tool, as ubq tests.
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assert, cleanup, test } from 'ubqtest'
import { convertSource, todoComment } from '../src/convert.ts'
import { project } from './setup.ts'
import { fullTodos } from './todos.ts'

// The load hook of the counters loads the parser with `require`,
// while this file loads. A static import of the same module from
// this file is an error in Node (a cycle of `require` and `import`).
// Deno cannot load this module with `require`.
const { parse, children }: typeof import('../src/instrument.ts') = process.versions.deno
  ? await import('../src/instrument.ts')
  : createRequire(import.meta.url)('../src/instrument.ts')

/** The TODO text for a matcher of expect. */
const MATCHER =
  'ubq has no expect. In a pattern, a partial object does the work of objectContaining, a RegExp does the work of stringContaining and stringMatching, and the object any of ubqtest does the work of the other matchers: any.number, any.instanceOf(URL), any.defined, any.arrayWith(a, b). A pattern is the second argument of assert.match, and of assert.matchOnly, which permits no key that the pattern does not have. assert.deepEqual compares a function as a value: change it to assert.matchOnly. An array in a pattern must have the length of the value: for some elements, any.arrayWith. For a call of a spy with arguments of a shape: assert(s.calls.some(call => isMatch(call.args, [pattern]))).'

/** The lines of a TODO comment. */
const todo = (text: string, indent = ''): string[] => todoComment(indent, text).trimEnd().split('\n')

const convert = (source: string, file = 'a.ts') => {
  const r = fullTodos(convertSource(source, file, parse, children))
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
    "  assert.equal(parse('c')?.kind, 'circle', 'the kind')",
    "  assert.deepEqual(parse('s'), { kind: 'square', side: 2 })",
    "  assert(!(parse('x') || false))",
    "  assert.throws(() => parse('?'), Error, 'throws')",
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
    '// TODO(ubq): This assertion is in no test. It runs when the file loads,',
    '// and a failure is an error of the file, not of a test. If it is a check',
    '// of the code under test, put it in a test().',
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
    "import { assert, describe, isDeepEqual, spy, test } from 'ubqtest'",
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
    '    assert(s.calls.some(call => isDeepEqual(call.args, [1, 2])))',
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
    "  assert.equal(1, 1, 'one')",
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
    'convert: 1 file to change, 0 TODO comments',
  ])
  assert.match(readFileSync(file, 'utf8'), /from 'tap'/)
  assert.deepEqual(p.ubq('convert', 'old.ts').out.split('\n'), [
    'converted old.ts (tap): 9 changes, 0 TODO',
    'convert: 1 file changed, 0 TODO comments',
    'note: 1 of these files has tests, and does not have a name that ubq runs (*.test.ts): old.ts. Rename them, or add to package.json: "ubq": { "include": ["old.ts"] }. Use "exclude" for files in that folder that are not test files.',
    'next: read `ubq guide convert`, do each TODO(ubq), then run: ubq',
    '',
  ])
  assert.equal(p.ubq('old.ts').last, 'pass: 0 failed, 2 passed')
  // A second conversion finds nothing to do.
  assert.equal(
    p.ubq('convert', 'old.ts').out,
    'convert: 0 files changed, 0 TODO comments, 1 file with no known test tool (old.ts)\n',
  )
  assert.deepEqual([p.ubq('convert').code, p.ubq('convert', 'nope').code], [4, 4])
  assert.match(p.ubq('guide', 'convert').out, /^# ubq guide: convert\n/)
  // A TypeScript file in a folder.
  mkdirSync(join(p.dir, 'spec'))
  writeFileSync(join(p.dir, 'spec/a.ts'), "import { expect, it } from 'vitest'\nit('a', () => expect(1).toBe(1))\n")
  assert.match(p.ubq('convert', '--dry', 'spec/a.ts').out, /"include": \["spec\/\*\*\/\*\.ts"\]/)
  // Files with a name such as a.spec.ts: the glob has that end, so
  // that a source file in the folder is not a test file.
  for (const name of ['spec/b.spec.ts', 'spec/c.spec.tsx'])
    writeFileSync(join(p.dir, name), "import { expect, it } from 'vitest'\nit('a', () => expect(1).toBe(1))\n")
  assert.match(
    p.ubq('convert', '--dry', 'spec/b.spec.ts', 'spec/c.spec.tsx').out,
    /"include": \["spec\/\*\*\/\*\.spec\.ts","spec\/\*\*\/\*\.spec\.tsx"\]/,
  )
  // Tests of Playwright Test: the notes from the config of that tool.
  writeFileSync(
    join(p.dir, 'spec/page.ts'),
    "import { test, expect } from '@playwright/test'\ntest('title', async ({ page }) => {\n  await expect(page).toHaveTitle('x')\n})\n",
  )
  writeFileSync(join(p.dir, 'playwright.config.ts'), "export default { use: { baseURL: 'http://localhost:4173' } }")
  const pages = p.ubq('convert', '--dry', 'spec/page.ts').out
  assert.match(pages, /^to convert spec\/page\.ts \(playwright\): 3 changes, 0 TODO$/m)
  assert.match(
    pages,
    /^note: ubq does not read playwright\.config\.ts\. For the address of the pages and the server of the tests, add to "ubq" in package\.json: "browser": \{"url":"http:\/\/localhost:4173"\}$/m,
  )
  p.configure({ browser: { url: 'http://localhost:4173' } })
  assert(!p.ubq('convert', '--dry', 'spec/page.ts').out.includes('playwright.config.ts'))
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
    expect(ratio / plain).toBeCloseTo(1 + bonus, 6)
    expect(staff).toBeGreaterThan(5)
    expect(a + b).toBeLessThan(c)
    expect(staff).not.toBeLessThan(5)
    expect(staff).toBeGreaterThanOrEqual(5)
    expect(staff).toBeLessThanOrEqual(5)
    expect(staff).not.toBeLessThanOrEqual(5)
    expect(staff).not.toBeCloseTo(5)
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
      'ubq has no hooks. If the work is not async, put it in the function of the describe, as a const: it runs one time, when the file loads. If it is async, make a function that does it one time, and await it at the start of each test of the group: let ready; const setup = () => (ready ??= work()).',
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
    '    assert.close(1.234, 1.23)',
    '    assert.close(ratio / plain, 1 + bonus, 6)',
    '    assert.greaterThan(staff, 5)',
    '    assert.lessThan(a + b, c)',
    '    assert(!(staff < 5))',
    '    assert.greaterThanOrEqual(staff, 5)',
    '    assert.lessThanOrEqual(staff, 5)',
    '    assert(!(staff <= 5))',
    '    assert(!(Math.abs(staff - 5) < 0.005))',
    "    assert(!(Reflect.has(Object(o), 'k')))",
    ...todo(
      "toHaveProperty('a.b') passes for one key with the name 'a.b', and for the key b of the object at the key a. Look at the value to see which one it has. For one key with a dot in its name: assert('a.b' in x). For a path of keys: assert('b' in x.a). Use assert(!(...)) for not.",
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

/** The lines after the first one of the TODO for a name of `cloudflare:test` that ubq does not have. */
const WORKERS_TODO = [
  '// executionContext, scheduledController, and migrate. For',
  '// SELF.fetch(request), use exports.default.fetch(request), with exports',
  "// from 'cloudflare:workers'. Write the test without the other names.",
]

test('vitest for Workers: SELF.fetch is exports.default.fetch of cloudflare:workers', () => {
  const file = (use: string): string[] =>
    convert(`import { env, SELF } from 'cloudflare:test'
import { expect, it } from 'vitest'
it('responds', async () => {
  ${use}
  expect(env.MODE).toBe('test')
})
`)!.code
  assert.deepEqual(file("expect((await SELF.fetch('http://x/', { method: 'POST' })).status).toBe(200)").slice(0, 4), [
    "import { env, exports } from 'cloudflare:workers'",
    "import { assert, test } from 'ubqtest'",
    "test('responds', async () => {",
    "  assert.equal((await exports.default.fetch('http://x/', { method: 'POST' })).status, 200)",
  ])
  // The name as a value, and a file that has the name `exports`: no change.
  for (const use of ['await call(SELF)', "await SELF.fetch('http://x/'); module.exports = 1"])
    assert.deepEqual(file(use).slice(0, 6), [
      "// TODO(ubq): ubq has no 'cloudflare:test'. 'ubqtest/workers' has",
      ...WORKERS_TODO,
      "import { env } from 'cloudflare:workers'",
      "import { SELF } from 'cloudflare:test'",
    ])
  // A name with no use goes away.
  assert.equal(file('await 1')[0], "import { env } from 'cloudflare:workers'")
})

test('vitest for Workers: the names of cloudflare:test', () => {
  const r =
    convert(`import { env, createExecutionContext, waitOnExecutionContext, createScheduledController, applyD1Migrations, fetchMock } from 'cloudflare:test'
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
    ...WORKERS_TODO,
    "import { env } from 'cloudflare:workers'",
    "import { executionContext, migrate, scheduledController } from 'ubqtest/workers'",
    "import { fetchMock } from 'cloudflare:test'",
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
    "import { any, assert, test } from 'ubqtest'",
    "test('a', () => {",
    '  assert(!text.match(/re/))',
    "  assert.contains(row.tags, 'x')",
    "  assert.contains(rows[0], 'x')",
    "  assert.contains(a?.b, 'x')",
    // An exact comparison with a matcher: a pattern with no other keys.
    '  assert.matchOnly(res.json(), { count: any.number })',
    '  assert.match(last, { content: /a\\.b/ })',
    ...todo(MATCHER, '  '),
    "  assert.match(last, { content: expect.not.stringContaining('c') })",
    '  // TODO(ubq): vitest and jest accept a string or an Error here.',
    '  // assert.throws needs an Error class, a RegExp, or a partial object. If',
    '  // this value is a string, make a RegExp from it. If it is an Error, use',
    '  // { message: error.message }.',
    '  assert.throws(() => f(), message)',
    '  assert.throws(() => f(), TypeError)',
    '})',
  ])
})

test('vitest: any and anything in a pattern become the functions of the object any', () => {
  const source = `import { expect, it } from 'vitest'
it('a', () => {
  expect(x).toMatchObject({
    a: expect.any(Number),
    b: [expect.any(String), expect.any(Boolean), expect.any(Function), expect.any(BigInt), expect.any(Symbol)],
    c: { d: expect.any(Object), e: expect.any(Array), f: expect.any(URL), g: expect.any(ns.Thing) },
    h: expect.anything(),
  })
  expect(() => f()).toThrow({ code: expect.any(Number) })
  expect(() => f()).toThrow(expect.any(Error))
  expect(x).toMatchObject(expect.any(Object))
  expect(x).toMatchObject({ a: expect.any(v), b: expect.any(), c: expect.any('text'), d: expect.anything(1) })
  expect(x).toEqual({ a: expect.any(Number), b: expect.anything() })
})
`
  const r = convert(source)
  assert(r)
  assert.deepEqual(r.code, [
    "import { any, assert, test } from 'ubqtest'",
    "test('a', () => {",
    '  assert.match(x, {',
    '    a: any.number,',
    '    b: [any.string, any.boolean, any.function, any.bigint, any.symbol],',
    '    c: { d: any.object, e: any.array, f: any.instanceOf(URL), g: any.instanceOf(ns.Thing) },',
    '    h: any.defined,',
    '  })',
    '  assert.throws(() => f(), { code: any.number })',
    // At the top level of the expected value, a function is a class.
    ...todo(MATCHER, '  '),
    '  assert.throws(() => f(), expect.any(Error))',
    ...todo(MATCHER, '  '),
    '  assert.match(x, expect.any(Object))',
    // A class with the name of the parameter, and wrong arguments.
    ...todo(MATCHER, '  '),
    "  assert.match(x, { a: any.instanceOf(v), b: expect.any(), c: expect.any('text'), d: expect.anything(1) })",
    // An exact comparison: no other keys.
    '  assert.matchOnly(x, { a: any.number, b: any.defined })',
    '})',
  ])
  // A JavaScript file has the same form.
  assert.deepEqual(convert(source, 'a.test.js')?.code.slice(2, 4), ['  assert.match(x, {', '    a: any.number,'])
})

test('vitest: code that an ES module on Node cannot run', () => {
  const r = convert(`/** @vitest-environment jsdom */
import { beforeAll, expect, it, vi } from 'vitest'
const enum A { X }
declare enum B { Y }
class C { constructor(public v: string) {} }
const d = __dirname, o = { __filename, __dirname: 1, x: o.__dirname }, r = require('x'), q = require.resolve('y')
const s = vi.fn(() => 1) as Foo
const u = vi.fn() as unknown as Bar
call(vi.fn() as Foo)
beforeAll(() => {
  start()
});
it('a', () => { expect(s).toHaveBeenCalled() })
`)
  assert(r)
  assert.deepEqual(r.code, [
    '/** @vitest-environment jsdom */',
    ...todo(
      'This file needs a DOM. ubq has no test environment. For a library that reads the document when it loads, such as Testing Library, make the DOM in a helper file that then loads the library, and import render and screen from that file: see "Testing Library" in `ubq guide convert`. For other tests, make the DOM in each test that needs it, with a function that stubs the globals: see "A DOM".',
    ),
    "import { assert, spy, test } from 'ubqtest'",
    ...todo(
      'Node runs TypeScript with the types removed, and it cannot run an enum. Make it an object: const Name = { A: 0, B: 1 } as const.',
    ),
    'const enum A { X }',
    'declare enum B { Y }',
    ...todo(
      'Node runs TypeScript with the types removed, and it cannot run a parameter property. Declare the field in the class, and assign it in the constructor.',
    ),
    'class C { constructor(public v: string) {} }',
    ...todo(
      "An ES module has no require. Use an import statement, await import('name'), or createRequire(import.meta.url) of node:module.",
    ),
    "const d = import.meta.dirname, o = { __filename: import.meta.filename, __dirname: 1, x: o.__dirname }, r = require('x'), q = require.resolve('y')",
    // A cast of a spy in a declaration hides its type.
    'const s = spy(() => 1)',
    'const u = spy()',
    'call(spy() as Foo)',
    // A block needs no `;`.
    '{',
    '  start()',
    '}',
    "test('a', () => { assert(s.calls.length > 0) })",
  ])
  // A file that makes its own values keeps them.
  const own = convert(`import { createRequire } from 'node:module'
import { expect, it } from 'vitest'
const require = createRequire(import.meta.url)
const __dirname = '.'
it('a', () => { expect(require('x')).toBe(__dirname) })
`)
  assert.deepEqual(own?.code.slice(2), [
    'const require = createRequire(import.meta.url)',
    "const __dirname = '.'",
    "test('a', () => { assert.equal(require('x'), __dirname) })",
  ])
})

test('vitest: an Error instance as the expected error is a pattern for its message', () => {
  const r = convert(`import { expect, it } from 'vitest'
const error = new TypeError('x')
it('a', async () => {
  expect(() => f()).toThrow(error)
  expect(() => f()).toThrow(new Error('boom'))
  expect(() => f()).toThrow(new RangeError(\`a \${b}\`))
  expect(() => f()).toThrow(new MyError(code, 'x'))
  expect(() => f()).toThrow(new Error(text))
  await expect(p).rejects.toThrow(error)
  await expect(p).rejects.toThrowError(new Error('boom'))
})
`)
  assert.deepEqual(r?.code.slice(3, -1), [
    '  assert.throws(() => f(), { message: error.message })',
    "  assert.throws(() => f(), { message: 'boom' })",
    '  assert.throws(() => f(), { message: `a ${b}` })',
    "  assert.throws(() => f(), { message: new MyError(code, 'x').message })",
    '  assert.throws(() => f(), { message: new Error(text).message })',
    '  await assert.rejects(p, { message: error.message })',
    "  await assert.rejects(p, { message: 'boom' })",
  ])
})

const HOOK =
  'ubq has no hooks. Make a setup function and call it in each test. Use cleanup() for the work after a test.'

test('vitest: hooks that assign no outer variable become a setup function', () => {
  const r = convert(`import { afterEach, beforeEach, describe, expect, it } from 'vitest'
describe('a', () => {
  beforeEach(async () => {
    const made = 1
    list.length = 0
    await start(made)
  })
  afterEach(() => {
    stop()
  })
  it('one', () => {
    expect(1).toBe(1)
  })
  it('empty', async () => {})
  it.todo('later')
  describe('inner', () => {
    afterEach(async () => {
      await done()
    })
    for (const x of [1, 2]) {
      it('n' + x, () => {
        expect(x).toBe(x)
      })
    }
  })
  describe('plain', () => {
    it('two', () => {
      expect(2).toBe(2)
    })
  })
})
describe('assigns', () => {
  let client
  beforeEach(() => {
    client = make()
  })
  it('three', () => {
    expect(client).toBe(1)
  })
})
describe('a call that can make tests', () => {
  beforeEach(() => {
    reset()
  })
  shared()
  it('four', () => {})
})
describe('two hooks of one kind', () => {
  beforeEach(() => {
    a()
  })
  beforeEach(() => {
    b()
  })
  it('five', () => {})
})
describe('other forms', () => {
  beforeEach(() => reset())
  it('six', () => {})
  describe('a return, a parameter, a time limit, and this', () => {
    beforeEach(() => {
      return reset()
    })
    it('seven', () => {})
  })
  describe('a hook after a test', () => {
    it('eight', () => {})
    beforeEach(() => {
      reset()
    })
  })
})
`)
  assert(r)
  assert.deepEqual(r.code, [
    "import { assert, cleanup, describe, test } from 'ubqtest'",
    "describe('a', () => {",
    '  const setup = async () => {',
    '    cleanup(teardown)',
    '    const made = 1',
    '    list.length = 0',
    '    await start(made)',
    '  }',
    '  const teardown = () => {',
    '    stop()',
    '  }',
    "  test('one', async () => {",
    '    await setup()',
    '    assert.equal(1, 1)',
    '  })',
    "  test('empty', async () => { await setup() })",
    "  test('later', { skip: 'todo' }, () => {})",
    "  describe('inner', () => {",
    '    const setup2 = async () => {',
    '      await setup()',
    '      cleanup(async () => {',
    '      await done()',
    '    })',
    '    }',
    '    for (const x of [1, 2]) {',
    "      test('n' + x, async () => {",
    '        await setup2()',
    '        assert.equal(x, x)',
    '      })',
    '    }',
    '  })',
    "  describe('plain', () => {",
    "    test('two', async () => {",
    '      await setup()',
    '      assert.equal(2, 2)',
    '    })',
    '  })',
    '})',
    "describe('assigns', () => {",
    '  let client',
    ...todo(HOOK, '  '),
    '  beforeEach(() => {',
    '    client = make()',
    '  })',
    "  test('three', () => {",
    '    assert.equal(client, 1)',
    '  })',
    '})',
    "describe('a call that can make tests', () => {",
    ...todo(HOOK, '  '),
    '  beforeEach(() => {',
    '    reset()',
    '  })',
    '  shared()',
    "  test('four', () => {})",
    '})',
    "describe('two hooks of one kind', () => {",
    ...todo(HOOK, '  '),
    '  beforeEach(() => {',
    '    a()',
    '  })',
    ...todo(HOOK, '  '),
    '  beforeEach(() => {',
    '    b()',
    '  })',
    "  test('five', () => {})",
    '})',
    "describe('other forms', () => {",
    ...todo(HOOK, '  '),
    '  beforeEach(() => reset())',
    "  test('six', () => {})",
    "  describe('a return, a parameter, a time limit, and this', () => {",
    ...todo(HOOK, '    '),
    '    beforeEach(() => {',
    '      return reset()',
    '    })',
    "    test('seven', () => {})",
    '  })',
    "  describe('a hook after a test', () => {",
    "    test('eight', () => {})",
    ...todo(HOOK, '    '),
    '    beforeEach(() => {',
    '      reset()',
    '    })',
    '  })',
    '})',
  ])
  for (const hook of [
    'beforeEach(ctx => {\n  reset(ctx)\n})',
    'beforeEach(() => {\n  reset()\n}, 1000)',
    'beforeEach(function () {\n  this.x = 1\n})',
    'beforeEach(() => {\n  count++\n})',
    'beforeEach(() => {\n  ;[a, b] = pair()\n})',
    'beforeEach(reset)',
  ]) {
    const kept = convert(
      `import { beforeEach, expect, it } from 'vitest'\n${hook}\nit('a', () => {\n  expect(1).toBe(1)\n})\n`,
    )
    assert.deepEqual(kept?.code.slice(1 + todo(HOOK).length, -3), hook.split('\n'), hook)
  }
})

test('vitest: hooks with tests in an if, and a group with a try', () => {
  const r = convert(`import { afterEach, beforeEach, describe, expect, it } from 'vitest'
afterEach(() => {})
if (fast) {
  it('a', () => {
    expect(1).toBe(1)
  })
} else await it('b', () => {})
describe('group', () => {
  beforeEach(() => {
    reset()
  })
  try {
    it('c', () => {})
  } catch {}
})
`)
  assert.deepEqual(r?.code, [
    "import { assert, describe, test } from 'ubqtest'",
    ...todo(HOOK),
    'afterEach(() => {})',
    'if (fast) {',
    "  test('a', () => {",
    '    assert.equal(1, 1)',
    '  })',
    "} else await test('b', () => {})",
    "describe('group', () => {",
    ...todo(HOOK, '  '),
    '  beforeEach(() => {',
    '    reset()',
    '  })',
    '  try {',
    "    test('c', () => {})",
    '  } catch {}',
    '})',
  ])
  const done = convert(`import { afterEach, expect, it } from 'vitest'
afterEach(() => {})
if (fast) {
  it('a', () => {
    expect(1).toBe(1)
  })
} else await it('b', () => {})
`)
  assert.deepEqual(done?.code, [
    "import { assert, cleanup, test } from 'ubqtest'",
    'const setup = () => {',
    '  cleanup(() => {})',
    '}',
    'if (fast) {',
    "  test('a', () => {",
    '    setup()',
    '    assert.equal(1, 1)',
    '  })',
    "} else await test('b', () => { setup() })",
  ])
})

test('vitest: the setup functions from hooks run in the order of the hooks', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  writeFileSync(
    join(p.dir, 'old.ts'),
    `import { afterEach, beforeEach, describe, expect, it } from 'vitest'
const log: string[] = []
beforeEach(() => {
  log.push('top')
})
afterEach(async () => {
  await null
  log.push('top end')
})
it('first', () => {
  expect(log).toEqual(['top'])
})
describe('group', () => {
  beforeEach(async () => {
    await null
    log.push('group')
  })
  afterEach(() => {
    log.push('group end')
  })
  it('second', () => {
    expect(log).toEqual(['top', 'top end', 'top', 'group'])
  })
  it('third', () => {
    expect(log.slice(4)).toEqual(['group end', 'top end', 'top', 'group'])
  })
})
`,
  )
  assert.equal(p.ubq('convert', 'old.ts').out.split('\n')[0], 'converted old.ts (vitest): 11 changes, 0 TODO')
  assert.equal(p.ubq('old.ts').last, 'pass: 0 failed, 3 passed')
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
    "  assert(other.calls.some(call => isDeepEqual(call.args, ['a'])))",
    ...rejects,
    '  await expect(p).rejects.toBe(error)',
    '  await assert.rejects(p, TypeError)',
    '  await assert.rejects(p, { message: /x/ })',
    ...rejects,
    '  await expect(p).rejects.not.toBeInstanceOf(TypeError)',
    // Parentheses end an optional chain. The value of the chain can
    // be undefined, so the new property has `?.` too.
    '  assert.equal(event.exception?.values?.length, 2)',
    '  assert(event.exception?.values?.some((item: unknown) => isDeepEqual(item, { a: 1 })))',
    // With a matcher, the arguments of the call are a pattern.
    '  assert.match(fn.calls.at(-1)?.args, [/x/])',
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
    "  assert(fn.calls.some(call => isDeepEqual(call.args, ['a'])))",
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
  expect({ id: 1, at: new Date(), tags: ['a'], more: 1 }).toMatchObject({
    id: expect.any(Number),
    at: expect.any(Date),
    tags: [expect.any(String)],
    more: expect.anything(),
  })
})
`,
  )
  assert.equal(p.ubq('convert', 'old.ts').out.split('\n')[0], 'converted old.ts (vitest): 14 changes, 0 TODO')
  assert.equal(p.ubq('old.ts').last, 'pass: 0 failed, 1 passed')
})

test('vitest: the converted setup call, pattern checks of a spy, and rows of each pass, with their types', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  writeFileSync(
    join(p.dir, 'old.ts'),
    `import { beforeEach, describe, expect, it, vi } from 'vitest'
const box: { n?: number; list?: number[] } = {}
describe('g', () => {
  beforeEach(() => {
    box.list = [1]
  })
  it('a', () => {
    (box as { n?: number }).n = 1
    const fn = vi.fn()
    fn({ id: 1, more: 2 }, 'c')
    expect(fn).toHaveBeenCalledWith(expect.objectContaining({ id: expect.any(Number) }), 'c')
    expect(fn).not.toHaveBeenCalledWith(expect.any(String))
    expect(fn).toHaveBeenLastCalledWith(expect.anything(), expect.stringContaining('c'))
    expect(box).toEqual(expect.objectContaining({ n: 1 }))
    expect(box).toEqual({ n: 1, list: [expect.any(Number)] })
    expect(fn).toHaveBeenCalledWith({ id: 1, more: expect.any(Number) }, 'c')
    expect(box).not.toBeInstanceOf(Map)
    expect(box?.list).toHaveLength(1)
  })
  it.each([
    ['a', { n: 1 }, 1],
    ['b', { n: 2 }, 2],
  ])('each %s', (name, value, n) => {
    expect(value.n).toBe(n)
    expect(name.length).toBe(1)
  })
})
`,
  )
  assert.match(p.ubq('convert', 'old.ts').out.split('\n')[0], /^converted old\.ts \(vitest\): \d+ changes, 0 TODO$/)
  // With the type check: each name of the loop has the type of its place.
  writeFileSync(
    join(p.dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        module: 'nodenext',
        target: 'esnext',
        strict: true,
        noEmit: true,
        allowImportingTsExtensions: true,
        types: ['node'],
      },
      include: ['old.ts'],
    }),
  )
  const modules = fileURLToPath(new URL('../node_modules/', import.meta.url))
  for (const name of ['typescript', '@types'])
    symlinkSync(join(modules, name), join(p.dir, 'node_modules', name), 'junction')
  const run = p.ubq('old.ts')
  assert.equal(run.last, 'pass: 0 failed, 3 passed', run.out)
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
  vi.stubEnv(name, '1')
  vi.stubGlobal('navigator', { userAgent: 'x' })
  vi.unstubAllGlobals()
  vi.getTimerCount()
})
describe.each([1])('g %s', n => {})
describe.each(rows)('h %s', n => {})
it.skipIf(a)('b', () => {})
describe.runIf(a)('c', () => {})
`)
  assert(r)
  assert.deepEqual(r.code, [
    "import { assert, describe, env, isDeepEqual, stub, test } from 'ubqtest'",
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
    "  env({ A: '1' })",
    "  env({ [name]: '1' })",
    "  stub(globalThis, 'navigator', { userAgent: 'x' })",
    ...todo('Delete this call. stub() puts back each value when the test ends.', '  '),
    '  vi.unstubAllGlobals()',
    ...todo(
      'Use fakeClock: const clock = fakeClock(), then await clock.tick(ms). The clock ends when its test ends.',
      '  ',
    ),
    '  vi.getTimerCount()',
    '})',
    'for (const n of [1]) describe(`g ${n}`, () => {})',
    ...todo(
      'Use a for loop around describe(). Each name must be different: put the value or the index in the name. Use JSON.stringify for an object.',
    ),
    "describe.each(rows)('h %s', n => {})",
    ...todo("Use an option of test(): { skip: condition && 'the reason' }."),
    "it.skipIf(a)('b', () => {})",
    ...todo("Use an option of describe(): { skip: !condition && 'the reason' }."),
    "describe.runIf(a)('c', () => {})",
  ])
})

test('vitest: the converted forms of the calls of a spy, of stubGlobal, and of stubEnv pass', () => {
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
  vi.stubGlobal('ubqConverted', 1)
  vi.stubEnv('UBQ_CONVERTED', 'yes')
  expect((globalThis as { ubqConverted?: number }).ubqConverted).toBe(1)
  expect(process.env.UBQ_CONVERTED).toBe('yes')
})
it('b', () => {
  expect((globalThis as { ubqConverted?: number }).ubqConverted).toBe(undefined)
  expect(process.env.UBQ_CONVERTED).toBe(undefined)
})
`,
  )
  assert.equal(p.ubq('convert', 'old.ts').out.split('\n')[0], 'converted old.ts (vitest): 22 changes, 0 TODO')
  assert.equal(p.ubq('old.ts').last, 'pass: 0 failed, 2 passed')
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
    '  assert(time.now.calls.some(call => isDeepEqual(call.args, [2])))',
    // The file replaces the module with vi.mock.
    ...real('send'),
    '  assert(send.calls.length > 0)',
    // A module that the file does not replace can export a spy.
    '  assert(read.calls.length > 0)',
    '  assert(helper.fn.calls.length > 0)',
    '  assert(s.calls.length > 0)',
    '  assert.equal(now, time.now)',
  ])
  assert.equal(r.code[0], "import { assert, isDeepEqual, spyOn, test } from 'ubqtest'")
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
    "  assert(list.some((item: unknown) => isDeepEqual(item, { contents: 'write' })))",
    '  assert(!(list.some((element: unknown) => isDeepEqual(element, item))))',
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
      .filter(line => /^note: (these|this command did not|formatted)/.test(line))
  const old =
    'note: these files still name the old test tool: old/env.d.ts, old/setup.ts, old/w.test.ts. Change them before you remove that tool.'
  // With --dry, no file changes: there is nothing to format.
  assert.deepEqual(notes('--dry', 'old'), [old])
  assert.deepEqual(notes('old'), [
    old,
    'note: this command did not format the code: prettier is not installed. To format the changed files: npx prettier --write old/a.test.ts old/w.test.ts',
  ])
  // The formatter of the project runs on the files that changed.
  const bin = join(p.dir, 'node_modules/.bin')
  mkdirSync(bin, { recursive: true })
  const formatter = (code: string): void => {
    writeFileSync(join(bin, 'prettier.mjs'), `import { appendFileSync } from 'node:fs'\n${code}\n`)
    writeFileSync(join(bin, 'prettier'), `#!/bin/sh\nexec node "${join(bin, 'prettier.mjs')}" "$@"\n`, { mode: 0o755 })
    writeFileSync(join(bin, 'prettier.cmd'), `@node "${join(bin, 'prettier.mjs')}" %*\r\n`)
  }
  const again = (): void =>
    writeFileSync(
      join(p.dir, 'old/a.test.ts'),
      "import { expect, it } from 'vitest'\nit('a', () => expect(1).toBe(1))\n",
    )
  formatter('for (const file of process.argv.slice(3)) appendFileSync(file, `// ${process.argv[2]}\\n`)')
  again()
  assert.deepEqual(notes('old/a.test.ts'), ['note: formatted the changed files with prettier.'])
  assert.match(readFileSync(join(p.dir, 'old/a.test.ts'), 'utf8'), /assert\.equal\(1, 1\)\)\n\/\/ --write\n$/)
  formatter("console.error('no config\\nmore'); process.exit(2)")
  again()
  assert.deepEqual(notes('old/a.test.ts'), [
    'note: this command did not format the code: prettier failed (no config). To format the changed files: npx prettier --write old/a.test.ts',
  ])
  formatter('process.exit(3)')
  again()
  assert.deepEqual(notes('old/a.test.ts'), [
    'note: this command did not format the code: prettier failed (exit code 3). To format the changed files: npx prettier --write old/a.test.ts',
  ])
  // A workspace: the formatter is in a folder around the project.
  mkdirSync(join(p.dir, 'pkg/test'), { recursive: true })
  writeFileSync(join(p.dir, 'pkg/package.json'), '{ "type": "module" }')
  writeFileSync(
    join(p.dir, 'pkg/test/a.test.ts'),
    "import { expect, it } from 'vitest'\nit('a', () => expect(1).toBe(1))\n",
  )
  formatter("for (const file of process.argv.slice(3)) appendFileSync(file, '// done\\n')")
  const inner = spawnSync('node', [join(p.dir, 'node_modules/ubqtest/src/cli.ts'), 'convert', 'test'], {
    cwd: join(p.dir, 'pkg'),
    encoding: 'utf8',
  })
  assert.match(inner.stdout, /^note: formatted the changed files with prettier\.$/m)
  assert.match(readFileSync(join(p.dir, 'pkg/test/a.test.ts'), 'utf8'), /\/\/ done\n$/)
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
      'note: 1 of these files has tests, and does not have a name that ubq runs (*.test.ts): old/top.ts. Rename them, or add to package.json: "ubq": { "include": ["old/**/*.ts"] }. Use "exclude" for files in that folder that are not test files.',
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
      '// TODO(ubq): This assertion is in no test. It runs when the file loads,',
      '// and a failure is an error of the file, not of a test. If it is a check',
      '// of the code under test, put it in a test().',
      "assert(2, 'last')",
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
    'convert: 6 files to change, 0 TODO comments, 1 file not converted (see the lines above), 11 files with no known test tool (plain/file00.js, plain/file01.js, plain/file02.js, plain/file03.js, plain/file04.js, plain/file05.js, plain/file06.js, plain/file07.js, plain/file08.js, plain/file09.js, and 1 more)',
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
    /\nnote: 1 of these files is tests of a Cloudflare Worker\. Such a file must run in the Workers runtime\. Add to package\.json: "ubq": \{ "workers": /,
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

test('tap: the before script is not a test file, and it gets a TODO', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  mkdirSync(join(p.dir, 'test'))
  const setup = "import t from 'tap'\nt.test('fixtures', { bail: true }, t => t.end())\n"
  writeFileSync(join(p.dir, 'test/00-setup.ts'), setup)
  writeFileSync(join(p.dir, 'test/a.test.ts'), "import t from 'tap'\nt.equal(1, 1)\n")
  writeFileSync(join(p.dir, '.taprc'), "jobs: 1\nbefore: './test/00-setup.ts'\n")
  const out = p.ubq('convert', 'test').out
  assert(
    out.startsWith(
      'converted test/00-setup.ts (tap): 0 changes, 1 TODO\n  test/00-setup.ts:1  [1] This file was the before script of tap, which ran it one time before all test files.\n',
    ),
  )
  const head = readFileSync(join(p.dir, 'test/00-setup.ts'), 'utf8')
  assert(head.startsWith('// TODO(ubq): This file was the before script of tap,'))
  assert(head.endsWith(`\n${setup}`))
  // A second run adds no second TODO.
  p.ubq('convert', 'test/00-setup.ts')
  assert.equal(readFileSync(join(p.dir, 'test/00-setup.ts'), 'utf8'), head)
  // The key of package.json.
  rmSync(join(p.dir, '.taprc'))
  writeFileSync(join(p.dir, 'test/00-setup.ts'), setup)
  writeFileSync(join(p.dir, 'package.json'), JSON.stringify({ type: 'module', tap: { before: 'test/00-setup.ts' } }))
  p.ubq('convert', 'test/00-setup.ts')
  assert.equal(readFileSync(join(p.dir, 'test/00-setup.ts'), 'utf8'), head)
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

test('vitest: convert writes the define values of the vite config, and the tests then run', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  writeFileSync(
    join(p.dir, 'vite.config.ts'),
    "export default { define: { __DEBUG_BUILD__: 'true', WINDOW: 'window' } }\n",
  )
  writeFileSync(
    join(p.dir, 'src/debug.ts'),
    'declare const __DEBUG_BUILD__: boolean\nexport const debug = __DEBUG_BUILD__\n',
  )
  writeFileSync(
    join(p.dir, 'old.ts'),
    "import { expect, it } from 'vitest'\nimport { debug } from './src/debug.ts'\nit('a', () => {\n  expect(debug).toBe(true)\n})\n",
  )
  const lines = (r: { out: string }) => r.out.split('\n').filter(l => /define/.test(l))
  const note =
    'note: the value of WINDOW in the define of vite.config.ts is not a plain value. Add it to "define" by hand.'
  assert.deepEqual(lines(p.ubq('convert', '--dry', 'old.ts')), [
    'add to "ubq" in package.json: "define": {"__DEBUG_BUILD__":true}',
    note,
  ])
  assert.deepEqual(lines(p.ubq('convert', 'old.ts')), [
    'wrote "ubq.define" to package.json: "define": {"__DEBUG_BUILD__":true}',
    note,
  ])
  assert.deepEqual(JSON.parse(readFileSync(join(p.dir, 'package.json'), 'utf8')).ubq, {
    define: { __DEBUG_BUILD__: true },
  })
  assert.equal(p.ubq('old.ts').last, 'pass: 0 failed, 1 passed')
  // The key is there: only the note.
  assert.deepEqual(lines(p.ubq('convert', 'old.ts')), [note])
  // A package.json that is not JSON: the command prints the key.
  writeFileSync(join(p.dir, 'package.json'), '{')
  assert.deepEqual(lines(p.ubq('convert', 'old.ts')), [
    'add to "ubq" in package.json: "define": {"__DEBUG_BUILD__":true}',
    note,
  ])
})

test('vitest: a table of each becomes a for loop, if each name is certain', () => {
  const r = convert(`import { describe, expect, it } from 'vitest'
it.each([[1, 2, 3], [2, 3, 5]])('%i + %i is %d', (a, b, sum) => {
  expect(a + b).toBe(sum)
})
it.each([{ a: 'x', n: 1 }, { a: 'y', n: 2 }])('$a is $n, %%', ({ a, n }) => {
  expect(a).toBeTruthy()
})
it.each([{ a: 'x' }, { a: 'x' }])('row $a', row => {
  expect(row.a).toBe('x')
})
it.each([1, 2])('no value', async n => {
  expect(n).toBeTruthy()
})
it.each(['a\`b', null, undefined, -1])(\`%s #%# $x \\\${y}\`, value => {
  expect(value).not.toBe(2)
})
it.each([[1, 'a']])('typed %j', (n: number, s?: string) => {
  expect(s).toBe('a')
})
it.each([1])('one %s', (n?: number) => {
  expect(s).toBe('a')
})
it.each([{ n: 1 }, { n: 1 }])('typed', ({ n }: { n: number }) => {
  expect(n).toBe(1)
})
describe.each\`a\n\${1}\`('$a', ({ a }) => {})
describe.each([[1], [2]])('group %s', n => {
  it('in', () => {
    expect(n).toBeTruthy()
  })
})
it.each([[x]])('%s', x => {})
it.each([[1]])('%s %s', a => {})
it.each([[1, {}]])('%s %s', (a, b) => {})
it.each([{ a: 1 }])('%s', row => {})
it.each([{ a: { b: 1 } }])('$a.b', row => {})
it.each([{ a: 1 }])('$a', ({ a: b }) => {})
it.each([[1], 2])('%s', a => {})
it.each([[1]])('%o', a => {})
it.each([[1, 2]])('%s', (a, b: number) => {})
it.each([[1]])('%s', ([a]) => {})
it.each([1, 1])('%s', i => {})
it.each([1])(name, a => {})
it.each([1])('%s', () => {})
it.each\`a\n\${1}\`('$a', ({ a }) => {})
it.each([1])('x', a => {}, 1000)
it.each([1])('%s %s', a => {})
it.each([1])('x', (a = 1) => {})
tag\`x\`
it.each([[o.a], [o['b']]])('a\`b %#', c => {})
it.each([{ 'k': 1 }])('$k', row => {})
`)
  assert(r)
  const each =
    'Use a for loop around test(). Each name must be different: put the value or the index in the name. Use JSON.stringify for an object: %s of an object is [object Object].'
  assert.deepEqual(r.code, [
    "import { assert, describe, test } from 'ubqtest'",
    'for (const [a, b, sum] of [[1, 2, 3], [2, 3, 5]] as const) test(`${a} + ${b} is ${sum}`, () => {',
    '  assert.equal(a + b, sum)',
    '})',
    "for (const { a, n } of [{ a: 'x', n: 1 }, { a: 'y', n: 2 }]) test(`${a} is ${n}, %`, () => {",
    '  assert(a)',
    '})',
    "for (const [i, row] of [{ a: 'x' }, { a: 'x' }].entries()) test(`row ${row.a} (${i})`, () => {",
    "  assert.equal(row.a, 'x')",
    '})',
    'for (const [i, n] of [1, 2].entries()) test(`no value (${i})`, async () => {',
    '  assert(n)',
    '})',
    "for (const [i, value] of ['a`b', null, undefined, -1].entries()) test(`${value} #${i} \\$x \\${y}`, () => {",
    '  assert.notEqual(value, 2)',
    '})',
    "for (const [n, s] of [[1, 'a']] as [number, string?][]) test(`typed ${JSON.stringify(n)}`, () => {",
    "  assert.equal(s, 'a')",
    '})',
    'for (const n of [1] as (number | undefined)[]) test(`one ${n}`, () => {',
    "  assert.equal(s, 'a')",
    '})',
    'for (const [i, { n }] of ([{ n: 1 }, { n: 1 }] as { n: number }[]).entries()) test(`typed (${i})`, () => {',
    '  assert.equal(n, 1)',
    '})',
    ...todo(
      'Use a for loop around describe(). Each name must be different: put the value or the index in the name. Use JSON.stringify for an object.',
    ),
    'describe.each`a',
    "${1}`('$a', ({ a }) => {})",
    'for (const [n] of [[1], [2]] as const) describe(`group ${n}`, () => {',
    "  test('in', () => {",
    '    assert(n)',
    '  })',
    '})',
    ...todo(each),
    "it.each([[x]])('%s', x => {})",
    ...todo(each),
    "it.each([[1]])('%s %s', a => {})",
    ...todo(each),
    "it.each([[1, {}]])('%s %s', (a, b) => {})",
    ...todo(each),
    "it.each([{ a: 1 }])('%s', row => {})",
    ...todo(each),
    "it.each([{ a: { b: 1 } }])('$a.b', row => {})",
    ...todo(each),
    "it.each([{ a: 1 }])('$a', ({ a: b }) => {})",
    ...todo(each),
    "it.each([[1], 2])('%s', a => {})",
    ...todo(each),
    "it.each([[1]])('%o', a => {})",
    ...todo(each),
    "it.each([[1, 2]])('%s', (a, b: number) => {})",
    ...todo(each),
    "it.each([[1]])('%s', ([a]) => {})",
    ...todo(each),
    "it.each([1, 1])('%s', i => {})",
    ...todo(each),
    'it.each([1])(name, a => {})',
    ...todo(each),
    "it.each([1])('%s', () => {})",
    ...todo(each),
    'it.each`a',
    "${1}`('$a', ({ a }) => {})",
    ...todo(each),
    "it.each([1])('x', a => {}, 1000)",
    ...todo(each),
    "it.each([1])('%s %s', a => {})",
    ...todo(each),
    "it.each([1])('x', (a = 1) => {})",
    'tag`x`',
    "for (const [i, [c]] of [[o.a], [o['b']]].entries()) test(`a\\`b ${i}`, () => {})",
    "for (const row of [{ 'k': 1 }]) test(`${row.k}`, () => {})",
  ])
})

test('vitest: the loops from each run, with a different name for each row', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  writeFileSync(
    join(p.dir, 'old.ts'),
    `import { describe, expect, it } from 'vitest'
it.each([[1, 2, 3], [2, 3, 5]])('%i + %i is %d', (a, b, sum) => {
  expect(a + b).toBe(sum)
})
it.each([{ a: 'x' }, { a: 'x' }])('row $a', ({ a }) => {
  expect(a).toBe('x')
})
it.each([1, 2])('%# no value', n => {
  expect(n).toBeTruthy()
})
describe.each([['a'], ['b']])('group %s', s => {
  it('in', () => {
    expect(s.length).toBe(1)
  })
})
`,
  )
  assert.equal(p.ubq('convert', 'old.ts').out.split('\n')[0], 'converted old.ts (vitest): 10 changes, 0 TODO')
  assert.equal(p.ubq('old.ts').last, 'pass: 0 failed, 8 passed')
  assert.deepEqual(
    p
      .ubq('sql', 'select id from test order by line, id')
      .out.trim()
      .split('\n')
      .map(line => JSON.parse(line).id),
    [
      'old.ts > 1 + 2 is 3',
      'old.ts > 2 + 3 is 5',
      'old.ts > row x (0)',
      'old.ts > row x (1)',
      'old.ts > 0 no value',
      'old.ts > 1 no value',
      'old.ts > group a > in',
      'old.ts > group b > in',
    ],
  )
})

test('a name with the mark of a test ID in it has a TODO', () => {
  assert.deepEqual(
    convert("import { describe, it } from 'vitest'\nit('a > b', () => {})\ndescribe(`c > ${d}`, () => {})\n")?.todos
      .length,
    2,
  )
})

test('the new import has the semicolon and the quotes of the import that it replaces', () => {
  assert.deepEqual(
    convert(
      'import { it, expect } from "vitest";\nimport { f } from "./f.ts";\nit("a", () => {\n  expect(f()).toBe(1);\n});\n',
    )?.code,
    [
      'import { assert, test } from "ubqtest";',
      'import { f } from "./f.ts";',
      'test("a", () => {',
      '  assert.equal(f(), 1);',
      '});',
    ],
  )
  // jest has no import. The first import of the file is the model.
  assert.equal(
    convert('import { f } from "./f.ts";\nit("a", () => {\n  expect(f()).toBe(1);\n});\n')?.code[0],
    'import { assert, test } from "ubqtest";',
  )
})

test('ava: tests, modifiers, hooks, assertions, throws, and the context', () => {
  const r = convert(
    `import anyTest, { type TestFn } from 'ava'
import { parse } from '../src/parse.ts'

const test = anyTest as TestFn<{ db: Db }>

test.beforeEach(t => {
  t.context.db = open()
})
test.after.always(() => close())

test('basic', t => {
  t.is(parse('a'), 1, 'one')
  t.not(parse('a'), 2)
  t.deepEqual(parse('b'), { a: 1 })
  t.notDeepEqual(parse('b'), { a: 2 })
  t.like(parse('b'), { a: 1 })
  t.true(parse('c') === 3)
  t.false(isBad())
  t.truthy(parse('c'))
  t.falsy(parse('d') || x)
  t.regex(text, /a/)
  t.notRegex(a + b, /a/)
  t.throws(() => parse('?'))
  t.throws(() => parse('?'), { instanceOf: TypeError })
  t.throws(() => parse('?'), { message: /bad/, code: 'E' }, 'the message')
  const error = t.throws(() => parse('?'), { instanceOf: TypeError, message: 'x' })
  t.notThrows(() => parse('a'))
  t.notThrows(() => { parse('a') })
  t.snapshot(parse('z'))
  t.log('hello')
  t.pass()
  t.teardown(() => close())
  t.timeout(100)
  t.plan(3)
})

test.serial('async', async t => {
  await t.throwsAsync(load('x'), { instanceOf: Error })
  await t.throwsAsync(() => load('x'))
  await t.notThrowsAsync(load('y'))
  await t.notThrowsAsync(async () => load('y'))
  t.is(t.context.db.count, 1)
})

test.serial.only('only', t => {
  t.plan(1)
  t.assert(true)
})
test.skip('skipped', t => {
  t.fail('no')
})
test.todo('later')
test.failing('fails', t => { t.fail() })
test('macro', macro, 1, 2)
test('more', t => {
  t.throws(() => parse('?'), undefined, 'a message')
  t.throws(() => parse('?'), expectation)
  const value = t.notThrows(() => parse('a'))
  t.notThrowsAsync(load('z'))
  t.notThrows(check)
  t.throws(() => parse('?'), { ...shape })
  t.is(t.title, 'more')
})
`,
    'a.ts',
  )
  assert.deepEqual(
    [r?.framework, r?.todos.length, r?.code.join('\n')],
    [
      'ava',
      15,
      `import { assert, cleanup, isDeepEqual, test } from 'ubqtest'
import { parse } from '../src/parse.ts'


// TODO(ubq): ubq has no hooks. Make a setup function and call it in each
// test. Use cleanup() for the work after a test.
test.beforeEach(t => {
  // TODO(ubq): ubq has no t.context. Make the values in a setup function,
  // and call it in each test: const { value } = setup().
  t.context.db = open()
})
// TODO(ubq): ubq has no hooks. Make a setup function and call it in each
// test. Use cleanup() for the work after a test.
test.after.always(() => close())

test('basic', () => {
  assert.equal(parse('a'), 1, 'one')
  assert.notEqual(parse('a'), 2)
  assert.deepEqual(parse('b'), { a: 1 })
  assert(!isDeepEqual(parse('b'), { a: 2 }))
  assert.match(parse('b'), { a: 1 })
  assert.equal(parse('c') === 3, true)
  assert.equal(isBad(), false)
  assert(parse('c'))
  assert(!(parse('d') || x))
  assert.match(text, /a/)
  assert.equal((a + b).match(/a/), null)
  assert.throws(() => parse('?'), Error)
  assert.throws(() => parse('?'), TypeError)
  assert.throws(() => parse('?'), { message: /bad/, code: 'E' }) // the message
  // TODO(ubq): The second argument is an Error class, a RegExp for the
  // message, or a partial object: assert.throws(fn, { message: 'text',
  // code: 'E' }). assert.throws and assert.rejects return the error:
  // assert(error instanceof X).
  const error = t.throws(() => parse('?'), { instanceOf: TypeError, message: 'x' })
  parse('a')
  // TODO(ubq): ubq has no assertion for code that does not throw. Call the
  // function, with await for a promise: a test fails if its code throws.
  t.notThrows(() => { parse('a') })
  assert.snapshot(parse('z'))
  console.log('hello')
  assert(true)
  cleanup(() => close())
  // TODO(ubq): Use the option of test(): test(name, { timeout: ms }, fn).
  t.timeout(100)
})

test('async', async () => {
  await assert.rejects(load('x'), Error)
  await assert.rejects(() => load('x'), Error)
  await load('y')
  await load('y')
  // TODO(ubq): ubq has no t.context. Make the values in a setup function,
  // and call it in each test: const { value } = setup().
  assert.equal(t.context.db.count, 1)
})

// TODO(ubq): ubq has no .only. Run one test with: ubq <file>:<line>.
test('only', () => {
  assert(true)
})
// TODO(ubq): Give the reason: { skip: 'the reason' }.
test('skipped', { skip: 'TODO(ubq): the reason' }, () => {
  assert.fail('no')
})
test('later', { skip: 'todo' }, () => {})
// TODO(ubq): ubq has no test.failing.
test.failing('fails', () => { assert.fail('fail') })
// TODO(ubq): ubq has no macros. Give test() a function that calls the
// macro function, with assert of ubqtest in it.
test('macro', macro, 1, 2)
test('more', async () => {
  assert.throws(() => parse('?'), Error) // a message
  // TODO(ubq): The second argument is an Error class, a RegExp for the
  // message, or a partial object: assert.throws(fn, { message: 'text',
  // code: 'E' }). assert.throws and assert.rejects return the error:
  // assert(error instanceof X).
  t.throws(() => parse('?'), expectation)
  // TODO(ubq): ubq has no assertion for code that does not throw. Call the
  // function, with await for a promise: a test fails if its code throws.
  const value = t.notThrows(() => parse('a'))
  await load('z')
  // TODO(ubq): ubq has no assertion for code that does not throw. Call the
  // function, with await for a promise: a test fails if its code throws.
  t.notThrows(check)
  // TODO(ubq): The second argument is an Error class, a RegExp for the
  // message, or a partial object: assert.throws(fn, { message: 'text',
  // code: 'E' }). assert.throws and assert.rejects return the error:
  // assert(error instanceof X).
  t.throws(() => parse('?'), { ...shape })
  assert.equal(t.title, 'more')
})`,
    ],
  )
})

test('tape: assertions, subtests, and a test that ends in a callback', () => {
  const r = convert(
    `const test = require('tape')
const fs = require('fs')

test('sync', t => {
  t.plan(2)
  t.equal(1, 1, 'same')
  t.notDeepEqual({ a: 1 }, { a: 2 })
  t.doesNotThrow(() => f())
  t.doesNotMatch('abc', /x/)
  t.match('abc', /a/)
  t.notok(false)
  t.iferror(null)
  t.throws(() => f(), /bad/, 'throws bad')
  t.comment('hi')
  t.end()
})

test('callback', function (t) {
  fs.readFile('x', (err, data) => {
    t.error(err)
    t.equal(String(data), 'x')
    t.end()
  })
})

test('planned', t => {
  t.plan(1)
  setTimeout(() => t.ok(true), 10)
})

test('nested', t => {
  t.test('inner', st => {
    st.ok(1)
    st.end()
  })
  t.end()
})

test.skip('skipped', t => { t.fail() })
test.onFinish(() => done())
test('opts', { timeout: 500 }, t => {
  t.timeoutAfter(100)
  t.pass('ok')
  t.end()
})
test('promise', t => {
  load().then(() => t.end())
  t.throws(() => f(), 'a message')
})
t.end()
test('loop', t => {
  t.plan(2)
  ;[1, 2].forEach(n => t.ok(n))
})
test('both', function (t) {
  t.plan(1)
  if (skip) return t.end()
  run(function (t) { t.end() })
  run(() => { t.ok(1); t.end() })
})
test('async', async t => {
  await load()
  run(() => t.end())
})
`,
    'a.js',
  )
  assert.deepEqual(
    [r?.framework, r?.todos.length, r?.code.join('\n')],
    [
      'tape',
      6,
      `const { assert, describe, isDeepEqual, test } = require('ubqtest')
const fs = require('fs')

test('sync', () => {
  assert.equal(1, 1, 'same')
  assert(!isDeepEqual({ a: 1 }, { a: 2 }))
  f()
  assert.equal('abc'.match(/x/), null)
  assert.match('abc', /a/)
  assert(!false)
  assert(!null)
  assert.throws(() => f(), /bad/, 'throws bad')
  console.log('hi')
})

test('callback', () => new Promise(end => {
  fs.readFile('x', (err, data) => {
    assert(!err)
    assert.equal(String(data), 'x')
    end()
  })
}))

test('planned', () => {
  // TODO(ubq): ubq has no t.plan. A test ends when its function ends. If
  // an assertion of this test runs in a callback, make the test function
  // return a promise, and resolve it after the last assertion: test(name,
  // () => new Promise(end => { ... end() })). If not, delete this line.
  t.plan(1)
  setTimeout(() => assert(true), 10)
})

describe('nested', () => {
  test('inner', () => {
    assert(1)
  })
})

// TODO(ubq): Give the reason: { skip: 'the reason' }.
test('skipped', { skip: 'TODO(ubq): the reason' }, () => { assert.fail('fail') })
// TODO(ubq): ubq has no test.onFinish.
test.onFinish(() => done())
test('opts', { timeout: 500 }, () => {
  // TODO(ubq): Use the option of test(): test(name, { timeout: ms }, fn).
  t.timeoutAfter(100)
  assert(true, 'ok')
})
test('promise', () => new Promise(end => {
  load().then(() => end())
  assert.throws(() => f(), Error, 'a message')
}))
test('loop', () => {
  [1, 2].forEach(n => assert(n))
})
test('both', () => new Promise(end => {
  if (skip) return end()
  // TODO(ubq): ubq has no t.end. A test ends when its function ends. This
  // call is in a callback: make the test function return a promise that
  // the callback resolves.
  run(function (t) { t.end() })
  run(() => { assert(1); end() })
}))
test('async', async () => {
  await load()
  // TODO(ubq): ubq has no t.end. A test ends when its function ends. This
  // call is in a callback: make the test function return a promise that
  // the callback resolves.
  run(() => t.end())
})`,
    ],
  )
})

test('tape: the promise of a test that ends in a callback has a type in TypeScript, and a name that the file does not use', () => {
  const r = convert(
    `import test from 'tape'
const [end, done, ended] = names
test('typed', t => {
  later(() => t.end())
})
`,
    'a.ts',
  )
  assert.deepEqual(
    [r?.framework, r?.todos.length, r?.code.join('\n')],
    [
      'tape',
      0,
      `import { test } from 'ubqtest'
const [end, done, ended] = names
test('typed', () => new Promise<void>(endTest => {
  later(() => endTest())
}))`,
    ],
  )
})

test('Playwright Test: the page of a test, groups, checks that wait, and what has no certain form', () => {
  const r = convert(
    `import { test, expect, type Page, devices } from '@playwright/test';

test.use({ locale: 'fr-FR' });

test.describe('the counter', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/count.html');
  });

  test('counts', async ({ page }) => {
    await page.goto('/count.html');
    await page.getByRole('button', { name: 'Add' }).click();
    await expect(page.locator('#total')).toHaveText('1');
    await expect(page.locator('#total')).toHaveText(/^\\d$/);
    await expect(page.locator('li')).toHaveText(['a', 'b']);
    await expect(page.locator('#note')).toContainText('one (1)');
    await expect(page).toHaveTitle(/Count/);
    await expect(page).toHaveURL('https://example.com/count.html');
    await expect(page).toHaveURL('/count.html');
    await expect(page.getByRole('button')).toBeVisible();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.locator('input')).toBeDisabled();
    await expect(page.locator('li')).toHaveCount(3);
    await expect(page.locator('input')).toHaveValue('x');
    await expect(page.locator('a')).toHaveAttribute('href', /count/);
    await expect(page.locator('a')).toHaveClass(/active/);
    await expect(page.locator('#total')).toHaveText('2', { timeout: 10_000 });
    await expect(page.locator('li')).not.toHaveCount(3);
    expect(await page.title()).toBe('Count');
    expect.soft(await page.title()).toContain('Count');
    await expect.poll(() => page.locator('li').count()).toBe(3);
    await expect.poll(async () => rows(page)).toEqual({ a: 1 });
    expect(a || b).toBeVisible();
    await expect(page.locator('a')).toHaveAttribute('href');
    await expect(page.locator('#note')).toContainText(note);
  });

  test('context and a name', async ({ page: tab, context }) => {
    await context.addCookies([]);
    expect(tab.url()).toBe('about:blank');
  });

  test('request', async ({ request }) => {
    expect((await request.get('/api')).ok()).toBeTruthy();
  });

  test('no fixture', () => {
    expect(1).toBe(1);
  });

  test.skip('later', async ({ page }) => {});
  test.fixme('broken', async ({ page }) => {});

  test('steps', async ({ page }) => {
    test.skip(process.platform === 'win32', 'no links');
    test.setTimeout(60_000);
    await test.step('open', async () => {
      await page.goto('/');
    });
  });
});

test.describe.serial('in order', () => {
  test('one', async ({}) => {
    expect(1).toBe(1);
  });
});

const helper = async (page: Page) => page.title();

test('a function with no block', async ({ page }) => page.goto('/'));
test('a second argument', async ({ page }, info) => {
  expect(info.title).toBe('a second argument');
});
test('no statement', async ({ page }) => {});
test('not async', ({ context }) => {
  expect(context.pages().length).toBe(1);
});
test.describe.parallel('at the same time', () => {
  test('other names', async ({ page, ...rest }) => {
    expect(rest).toBeTruthy();
  });
});
`,
    'a.spec.ts',
  )
  assert.deepEqual(
    [r?.framework, r?.todos.length, r?.code.join('\n')],
    [
      'playwright',
      18,
      `import { assert, describe, test } from 'ubqtest';
import { browser } from 'ubqtest/browser';
import type { Page } from 'playwright-core';
import { devices } from 'playwright-core';

// TODO(ubq): ubq has no test.use. browser(options) takes the options of a
// context, such as viewport and locale: const page = await browser({
// locale: 'fr-FR' }). The address of the pages is "browser": { "url": ...
// } in the ubq configuration.
test.use({ locale: 'fr-FR' });

describe('the counter', () => {
  // TODO(ubq): ubq has no hooks. Make a function that opens the page, and
  // call it in each test: const open = async () => { const page = await
  // browser(); await page.goto('/'); return page }. Use cleanup() for the
  // work after a test.
  test.beforeEach(async ({ page }) => {
    await page.goto('/count.html');
  });

  test('counts', async () => {
    const page = await browser();
    await page.goto('/count.html');
    await page.getByRole('button', { name: 'Add' }).click();
    await assert.eventually(() => page.locator('#total').textContent(), '1');
    await assert.eventually(() => page.locator('#total').textContent(), /^\\d$/);
    await assert.eventually(() => page.locator('li').allTextContents(), ['a', 'b']);
    await assert.eventually(() => page.locator('#note').textContent(), /one \\(1\\)/);
    await assert.eventually(() => page.title(), /Count/);
    await assert.eventually(() => page.url(), 'https://example.com/count.html');
    // TODO(ubq): ubq has no expect. Read the value from the page, and wait
    // for it: await assert.eventually(() => locator.getAttribute('class'),
    // /active/). A check with a time limit of its own, or with not, has no
    // certain form.
    await expect(page).toHaveURL('/count.html');
    await assert.eventually(() => page.getByRole('button').isVisible(), true);
    await assert.eventually(() => page.getByRole('dialog').isVisible(), false);
    await assert.eventually(() => page.locator('input').isDisabled(), true);
    await assert.eventually(() => page.locator('li').count(), 3);
    await assert.eventually(() => page.locator('input').inputValue(), 'x');
    await assert.eventually(() => page.locator('a').getAttribute('href'), /count/);
    // TODO(ubq): ubq has no expect. Read the value from the page, and wait
    // for it: await assert.eventually(() => locator.getAttribute('class'),
    // /active/). A check with a time limit of its own, or with not, has no
    // certain form.
    await expect(page.locator('a')).toHaveClass(/active/);
    // TODO(ubq): ubq has no expect. Read the value from the page, and wait
    // for it: await assert.eventually(() => locator.getAttribute('class'),
    // /active/). A check with a time limit of its own, or with not, has no
    // certain form.
    await expect(page.locator('#total')).toHaveText('2', { timeout: 10_000 });
    // TODO(ubq): ubq has no expect. Read the value from the page, and wait
    // for it: await assert.eventually(() => locator.getAttribute('class'),
    // /active/). A check with a time limit of its own, or with not, has no
    // certain form.
    await expect(page.locator('li')).not.toHaveCount(3);
    assert.equal(await page.title(), 'Count');
    assert.contains(await page.title(), 'Count');
    await assert.eventually(() => page.locator('li').count(), 3);
    // TODO(ubq): ubq has no expect. Read the value from the page, and wait
    // for it: await assert.eventually(() => locator.getAttribute('class'),
    // /active/). A check with a time limit of its own, or with not, has no
    // certain form.
    await expect.poll(async () => rows(page)).toEqual({ a: 1 });
    await assert.eventually(() => (a || b).isVisible(), true);
    // TODO(ubq): ubq has no expect. Read the value from the page, and wait
    // for it: await assert.eventually(() => locator.getAttribute('class'),
    // /active/). A check with a time limit of its own, or with not, has no
    // certain form.
    await expect(page.locator('a')).toHaveAttribute('href');
    // TODO(ubq): ubq has no expect. Read the value from the page, and wait
    // for it: await assert.eventually(() => locator.getAttribute('class'),
    // /active/). A check with a time limit of its own, or with not, has no
    // certain form.
    await expect(page.locator('#note')).toContainText(note);
  });

  test('context and a name', async () => {
    const tab = await browser();
    const context = tab.context();
    await context.addCookies([]);
    assert.equal(tab.url(), 'about:blank');
  });

  // TODO(ubq): ubq has no fixtures. The page is: const page = await
  // browser(), from 'ubqtest/browser'. The context is page.context(). For
  // request, use fetch. For a fixture of the project, call a function in
  // the test.
  test('request', async ({ request }) => {
    assert((await request.get('/api')).ok());
  });

  test('no fixture', () => {
    assert.equal(1, 1);
  });

  // TODO(ubq): Give the reason: { skip: 'the reason' }.
  test('later', { skip: 'TODO(ubq): the reason' }, async () => {
    const page = await browser();
  });
  // TODO(ubq): Give the reason: { skip: 'the reason' }.
  test('broken', { skip: 'TODO(ubq): the reason' }, async () => {
    const page = await browser();
  });

  test('steps', async () => {
    const page = await browser();
    // TODO(ubq): This call skips the test while it runs. Use the option of
    // test(): test(name, { skip: condition && 'the reason' }, fn).
    test.skip(process.platform === 'win32', 'no links');
    // TODO(ubq): Use the option of test(): test(name, { timeout: ms },
    // fn).
    test.setTimeout(60_000);
    // TODO(ubq): ubq has no steps. Put the code of the step in the test,
    // with the name of the step in a comment.
    await test.step('open', async () => {
      await page.goto('/');
    });
  });
});

describe('in order', () => {
  test('one', async () => {
    assert.equal(1, 1);
  });
});

const helper = async (page: Page) => page.title();

// TODO(ubq): ubq has no fixtures. The page is: const page = await
// browser(), from 'ubqtest/browser'. The context is page.context(). For
// request, use fetch. For a fixture of the project, call a function in the
// test.
test('a function with no block', async ({ page }) => page.goto('/'));
// TODO(ubq): ubq has no fixtures. The page is: const page = await
// browser(), from 'ubqtest/browser'. The context is page.context(). For
// request, use fetch. For a fixture of the project, call a function in the
// test.
test('a second argument', async ({ page }, info) => {
  assert.equal(info.title, 'a second argument');
});
test('no statement', async () => {
  const page = await browser();
});
test('not async', async () => {
  const context = (await browser()).context();
  assert.equal(context.pages().length, 1);
});
describe('at the same time', () => {
  // TODO(ubq): ubq has no fixtures. The page is: const page = await
  // browser(), from 'ubqtest/browser'. The context is page.context(). For
  // request, use fetch. For a fixture of the project, call a function in
  // the test.
  test('other names', async ({ page, ...rest }) => {
    assert(rest);
  });
});`,
    ],
  )
})

test('Playwright Test in a CommonJS file', () => {
  const r = convert(
    `const { test, expect } = require('@playwright/test')
test('title', async ({ page }) => {
  await expect(page).toHaveTitle('x')
})
`,
    'c.spec.cjs',
  )
  assert.deepEqual(
    [r?.framework, r?.todos.length, r?.code.join('\n')],
    [
      'playwright',
      0,
      `const { assert, test } = require('ubqtest')
const { browser } = require('ubqtest/browser')
test('title', async () => {
  const page = await browser()
  await assert.eventually(() => page.title(), 'x')
})`,
    ],
  )
})

test('Playwright Test: a file with its own name browser keeps the fixture, with a TODO', () => {
  const r = convert(
    `import { test, expect } from '@playwright/test'
const browser = 1
test('a name of the file', async ({ page }) => {
  await expect(page).toHaveTitle('x')
})
`,
    'd.spec.ts',
  )
  assert.deepEqual(
    [r?.framework, r?.todos.length, r?.code.join('\n')],
    [
      'playwright',
      1,
      `import { assert, test } from 'ubqtest'
const browser = 1
// TODO(ubq): ubq has no fixtures. The page is: const page = await
// browser(), from 'ubqtest/browser'. The context is page.context(). For
// request, use fetch. For a fixture of the project, call a function in the
// test.
test('a name of the file', async ({ page }) => {
  await assert.eventually(() => page.title(), 'x')
})`,
    ],
  )
})

test('the Playwright library with a different test tool: a TODO at the launch of the browser', () => {
  const r = convert(
    `import { test, expect, beforeAll } from 'vitest'
import { chromium, type Browser } from 'playwright'
let browser: Browser
beforeAll(async () => {
  browser = await chromium.launch()
})
test('title', async () => {
  const page = await browser.newPage()
  expect(await page.title()).toBe('')
})
`,
    'b.test.ts',
  )
  assert.deepEqual(
    [r?.framework, r?.todos.length, r?.code.join('\n')],
    [
      'vitest',
      1,
      `import { assert, test } from 'ubqtest'
import { chromium, type Browser } from 'playwright'
let browser: Browser
{
  // TODO(ubq): ubq starts the browser, and closes the page when the test
  // ends: const page = await browser(), from 'ubqtest/browser'. Remove the
  // launch, the new page, and the close.
  browser = await chromium.launch()
}
test('title', async () => {
  const page = await browser.newPage()
  assert.equal(await page.title(), '')
})`,
    ],
  )
})

test('jest: jest-dom checks, a DOM library, types of jest, fail, a constant as the expected error, and a text that the file has two times', () => {
  // Not through fullTodos: a text that the file has two times has
  // its short form the second time.
  const r = convertSource(
    `/** @jest-environment node */
process.env.API_URL = 'http://localhost';
import { screen, render } from '@testing-library/react';
import { Service } from './service';
import { z } from 'zod';

const NOT_FOUND = 'not found';
let svc: jest.Mocked<Service>;
let spied: jest.SpiedFunction<typeof fetch>;

describe('service', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it.each([
    [1, 'one'],
    [2, 'two'],
  ])('maps %p to %p', (n, word) => {
    expect(map(n)).toBe(word);
  });

  it('rejects', async () => {
    await expect(svc.load()).rejects.toThrow(NOT_FOUND);
    await expect(svc.load()).rejects.toBeInstanceOf(Response);
    expect(list).toContainEqual(expect.stringContaining('warn'));
    if (!svc) fail('no service');
  });

  it('dom', () => {
    render(<div />);
    expect(screen.getByText('Hi')).toBeInTheDocument();
    expect(screen.queryByText('Bye')).not.toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/a');
    expect(screen.getByRole('link')).toHaveAttribute('download');
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    expect(screen.getByRole('status')).toHaveTextContent(/saved/i);
    expect(screen.getByRole('button')).toBeDisabled();
    expect(screen.getByRole('button')).toBeEnabled();
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(screen.getByRole('textbox')).toHaveValue('x');
    expect(screen.getByRole('status')).toHaveClass('ok');
    expect(screen.getByRole('status')).toBeVisible();
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('a > b', () => {
    expect(1).toBe(1);
  });
});
`,
    'a.spec.tsx',
    parse,
    children,
  )
  assert.deepEqual(
    [r?.framework, r?.todos.length, r?.code.trimEnd()],
    [
      'jest',
      8,
      `import { assert, describe, isMatch, test } from 'ubqtest';
// TODO(ubq): This file needs a DOM. ubq has no test environment. For a
// library that reads the document when it loads, such as Testing Library,
// make the DOM in a helper file that then loads the library, and import
// render and screen from that file: see "Testing Library" in \`ubq guide
// convert\`. For other tests, make the DOM in each test that needs it, with
// a function that stubs the globals: see "A DOM".
// TODO(ubq): The imports of an ES module run before this line, also the
// imports below it. If a module reads this value while it loads, load that
// module after this line: const { name } = await import(path). If no
// module reads it while it loads, this line is correct.
process.env.API_URL = 'http://localhost';
import { screen, render } from '@testing-library/react';
import { Service } from './service';
import { z } from 'zod';

const NOT_FOUND = 'not found';
// TODO(ubq): ubq has no types of jest or vitest. A spy has the type Spy<F>
// of 'ubqtest': import { type Spy } from 'ubqtest'. For an object of
// spies, give each key its type: { load: Spy<Service['load']> }. A
// function that returns the object gives the types with no annotation:
// const make = () => ({ load: spy(async () => user) }).
let svc: jest.Mocked<Service>;
// TODO(ubq): ubq has no types of jest or vitest. The full text is at the
// first TODO of this file with this sentence.
let spied: jest.SpiedFunction<typeof fetch>;

describe('service', () => {

  for (const [n, word] of [
    [1, 'one'],
    [2, 'two'],
  ] as const) test(\`maps \${JSON.stringify(n)} to \${JSON.stringify(word)}\`, () => {
    assert.equal(map(n), word);
  });

  test('rejects', async () => {
    await assert.rejects(svc.load(), /not found/);
    await assert.rejects(svc.load(), Response);
    assert(list.some((item: unknown) => isMatch(item, /warn/)));
    if (!svc) assert.fail('no service');
  });

  test('dom', () => {
    render(<div />);
    assert(screen.getByText('Hi').isConnected);
    assert(!screen.queryByText('Bye')?.isConnected);
    assert.equal(screen.getByRole('link').getAttribute('href'), '/a');
    assert(screen.getByRole('link').hasAttribute('download'));
    assert.contains(screen.getByRole('status').textContent, 'Saved');
    assert.match(screen.getByRole('status').textContent, /saved/i);
    assert(screen.getByRole('button').matches(':disabled'));
    assert(!screen.getByRole('button').matches(':disabled'));
    assert(screen.getByRole('checkbox').matches(':checked'));
    // TODO(ubq): ubq has no toHaveValue. Write an assertion with assert,
    // assert.equal, assert.deepEqual, or assert.match.
    expect(screen.getByRole('textbox')).toHaveValue('x');
    assert(screen.getByRole('status').classList.contains('ok'));
    // TODO(ubq): ubq has no toBeVisible. Write an assertion with assert,
    // assert.equal, assert.deepEqual, or assert.match.
    expect(screen.getByRole('status')).toBeVisible();
    // TODO(ubq): ubq has no toBeEmptyDOMElement. Write an assertion with
    // assert, assert.equal, assert.deepEqual, or assert.match.
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  // TODO(ubq): The name of a test or of a group must not have " > " in it:
  // ubq puts it between the names of the groups in the ID of a test. Use a
  // different mark, such as " - ".
  test('a > b', () => {
    assert.equal(1, 1);
  });
});`,
    ],
  )
})

test('jest: other forms of the jest-dom checks, of fail, and of a table of each', () => {
  const r = convert(
    `const TEXT = \`a\`
for (const el of list) {
  it('checks', async () => {
    await expect(load()).rejects.toThrow(NO_SUCH_NAME)
    expect(el).toHaveTextContent(text)
    expect(el).not.toHaveTextContent(/x/)
    expect(el).not.toHaveTextContent('x')
    expect(el).toHaveClass('a b')
    expect(el).toHaveClass('a', 'b')
    expect(screen.getByRole('status')).not.toBeInTheDocument()
    if (!el) fail()
  })
}
it.each([['a', -1]])('row %p %s', (a, b) => {
  expect(a).toBe(b)
})
`,
    'a.spec.ts',
  )
  const code = r!.code.filter(line => !line.trim().startsWith('//'))
  assert.deepEqual(code.slice(4, 12), [
    // With a TODO: the name is a constant, and the file does not have its text.
    '    await assert.rejects(load(), NO_SUCH_NAME)',
    '    expect(el).toHaveTextContent(text)',
    '    assert(!el.textContent?.match(/x/))',
    "    assert.notContains(el.textContent, 'x')",
    "    expect(el).toHaveClass('a b')",
    "    expect(el).toHaveClass('a', 'b')",
    "    assert(!screen.getByRole('status').isConnected)",
    "    if (!el) assert.fail('fail')",
  ])
  assert.equal(code.at(-3), "for (const [a, b] of [['a', -1]] as const) test(`row ${JSON.stringify(a)} ${b}`, () => {")
  assert.equal(r!.todos.length, 4)
})

test('vitest: toHaveBeenLastCalledWith is a check of the last call, and toHaveBeenCalledWith of any call', () => {
  const r = convert(`import { expect, it, vi } from 'vitest'
it('a', () => {
  const s = vi.fn()
  s(1)
  s()
  expect(s).toHaveBeenCalledWith(1)
  expect(s).toHaveBeenLastCalledWith()
})
`)
  assert.deepEqual(r!.code.slice(5, 7), [
    '  assert(s.calls.some(call => isDeepEqual(call.args, [1])))',
    '  assert.deepEqual(s.calls.at(-1)?.args, [])',
  ])
})

test('vitest: expect.fail, and stringMatching with a RegExp as the expected error', () => {
  const r = convert(`import { expect, it } from 'vitest'
it('x', () => {
  expect.fail('no')
  expect.fail()
  expect(() => load()).toThrow(expect.stringMatching(/x/))
  expect(v).toEqual({ a: expect.stringMatching(/y/i) })
})
`)
  assert.deepEqual(r!.code.filter(line => !line.trim().startsWith('//')).slice(2, 6), [
    "  assert.fail('no')",
    "  assert.fail('fail')",
    '  assert.throws(() => load(), /x/)',
    // An exact comparison with a matcher is a pattern with no other keys.
    '  assert.matchOnly(v, { a: /y/i })',
  ])
  assert.equal(r!.todos.length, 0)
})

test('vitest: convert writes the env values of the vitest config, and the tests then run', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  writeFileSync(
    join(p.dir, 'vitest.config.ts'),
    "export default { test: { env: { UBQ_TEST_MODE: 'dev', UBQ_TEST_KEY: process.env.KEY } } }\n",
  )
  writeFileSync(
    join(p.dir, 'old.ts'),
    "import { expect, it } from 'vitest'\nconst mode = process.env.UBQ_TEST_MODE\nit('a', () => {\n  expect(mode).toBe('dev')\n})\n",
  )
  assert.deepEqual(
    p
      .ubq('convert', 'old.ts')
      .out.split('\n')
      .filter(line => /env/.test(line)),
    [
      'wrote "ubq.env" to package.json: "env": {"UBQ_TEST_MODE":"dev"}',
      'note: vitest.config.ts has values in test.env that are not plain text (UBQ_TEST_KEY). Add them to "env" in "ubq" in package.json by hand.',
    ],
  )
  assert.equal(p.ubq('old.ts').last, 'pass: 0 failed, 1 passed')
})

test('ava: the message of notThrows is a comment, or a TODO if it is not text', () => {
  const r = convert(`import test from 'ava'
test('a', t => {
  t.notThrows(() => parse('a'), 'text')
  t.notThrows(() => parse('b'), \`plain\`)
  t.notThrows(() => parse('c'), name)
  t.is(parse('d'), 1, name)
})
`)
  const code = r!.code.filter(line => !line.trim().startsWith('//'))
  assert.deepEqual(code.slice(2, 6), [
    "  parse('a') // text",
    "  parse('b') // plain",
    "  parse('c')",
    "  assert.equal(parse('d'), 1, name)",
  ])
  assert.deepEqual(
    r!.todos.map(todo => todo.text.slice(0, 37)),
    ['This call is not an assertion now, so'],
  )
})

test('tap: a skip of the file, options of an assertion and of a test, a setting, a type, and code of a parent test', () => {
  const r = convert(
    `import t from 'tap'
import type { Test } from 'tap'
import type { Other } from 'tap'
import { glob } from '../src/index.js'

if (process.platform === 'win32') {
  t.plan(0, 'skip on windows')
  process.exit(0)
}
t.jobs = 64
const check = (t: Test, file: string) => {
  t.equal(file, 'a')
}
t.test('a parent with work', async t => {
  process.chdir('/')
  for await (const p of list) {
    t.test(p, async t => {
      t.same(await glob(p), [], 'msg', { todo: 'broken' })
      t.ok(p, { skip: false })
    })
  }
  for (const p of ['x']) t.test(p, { bail: true, timeout: 100 }, async t => t.pass('n/a', { skip: 'not here' }))
  t.end()
})
t.test('a parent with a loop of subtests', async t => {
  const names = ['x']
  for (const p of names) {
    t.test(p, async t => {
      const er = new Error('x')
      await t.rejects(glob(p), er)
      t.fixture('symlink', 'target')
    })
  }
})
t.equal(1, 1)
t.equal(2, 2)
`,
    'a.ts',
  )
  const code = r!.code.filter(line => !line.trim().startsWith('//'))
  assert.deepEqual(code, [
    "import { assert, describe, test } from 'ubqtest'",
    // A type that the file uses stays, with a TODO.
    "import type { Test } from 'tap'",
    "import { glob } from '../src/index.js'",
    '',
    "if (process.platform === 'win32') {",
    "  t.plan(0, 'skip on windows')",
    '  process.exit(0)',
    '}',
    't.jobs = 64',
    'const check = (t: Test, file: string) => {',
    "  assert.equal(file, 'a')",
    '}',
    // With an await of its own, the function stays async until the TODO is done.
    "describe('a parent with work', async () => {",
    "  process.chdir('/')",
    '  for await (const p of list) {',
    '    test(p, async () => {',
    "      assert.deepEqual(await glob(p), [], 'msg')",
    '      assert(p)',
    '    })',
    '  }',
    "  for (const p of ['x']) test(p, { bail: true, timeout: 100 }, async () => assert(true, 'n/a'))",
    '})',
    // A loop of subtests, and a declaration: no TODO.
    "describe('a parent with a loop of subtests', () => {",
    "  const names = ['x']",
    '  for (const p of names) {',
    '    test(p, async () => {',
    "      const er = new Error('x')",
    '      await assert.rejects(glob(p), { message: er.message })',
    "      t.fixture('symlink', 'target')",
    '    })',
    '  }',
    '})',
    'assert.equal(1, 1)',
    'assert.equal(2, 2)',
  ])
  assert.deepEqual(
    r!.todos.map(todo => todo.text.replace(/[.:] [^]*$/, '')),
    [
      'This type of tap is for a test object, and ubq has none',
      't.plan(0, reason) of tap skips the file',
      'ubq has no settings on a test object',
      'This code was in a test of tap, and ran after the tests before it',
      'The function of describe() must not be async',
      'tap does not count this assertion as a failure',
      'ubq has the options skip and timeout',
      'tap does not count this assertion as a failure',
      'ubq has no form of t.fixture',
      // One for the file.
      'This assertion is in no test',
    ],
  )
  // Code with no await in a parent that has only subtests: it runs when the file loads now.
  const effects = convert(
    "import t from 'tap'\nt.test('p', async t => {\n  process.chdir('/')\n  t.test('c', async t => t.pass())\n})\n",
  )
  assert.deepEqual(
    effects!.todos.map(todo => todo.text.slice(0, 66)),
    ['This code was in a test of tap, and ran after the tests before it.'],
  )
})

test('vitest: new statements end before code that can join them, a pattern for a check with a matcher, and forms with a TODO', () => {
  const r = convert(`// @vitest-environment node
import { beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
const cjs = { require }
export const maybe = (old: boolean) => (old ? it.skip : it)
let state: number
describe('g', () => {
  beforeEach(() => {
    reset()
  })
  it('a', () => {
    (globalThis as any).ids = 1
    expect(x).not.toBeInstanceOf(Foo)
    const m = fn as Mock
    expect(listener.mock.instances[0]).toBe(1)
    expect(s).toHaveBeenCalledWith(expect.objectContaining({ a: 1, b: expect.any(Number) }), 'c')
    expect(s).not.toHaveBeenCalledWith(expect.anything())
    expect(s).toHaveBeenCalledWith({ a: 1 }, expect.anything())
    expect(s).toHaveBeenCalledWith(expect.objectContaining({ a: { b: 1 } }))
    expect(s).toHaveBeenNthCalledWith(2, expect.stringMatching(/x/))
    expect(s).toHaveBeenCalledExactlyOnceWith(expect.any(Foo))
    expect(x).toEqual(expect.objectContaining({ a: [1, expect.anything()] }))
    expect(x).not.toEqual(expect.any(String))
    expect(x).toMatchObject({ a: expect.objectContaining({ b: undefined }) })
    expect(s).toHaveBeenCalledWith(-1, expect.any(Number))
    expect(s).toHaveBeenCalledWith(expect.any(), 1)
    expect(s).toHaveBeenCalledWith([, 1], expect.anything())
    expect(s.mock.invocationCallOrder[0]).toBe(1)
    vi.advanceTimersByTime(0)
  })
  describe('h', () => {
    beforeEach(() => {
      state = 1
    })
    it('b', () => {})
  })
  it.each([
    ['a', { n: 1 }, undefined],
    [undefined, { n: 2 }, 3],
  ])('each %#', (a, b, c) => {
    expect(f(a, b)).toBe(c)
  })
  it.each([
    ['a', undefined],
    ['b', 1],
  ])('plain %s', (a, b) => {
    expect(f(a)).toBe(b)
  })
})
describe('k', () => {
  beforeEach(() => {
    state = 2
  })
  describe('l', () => {
    beforeEach(() => {
      reset()
    })
    it('c', () => {
      [1].forEach(f)
    })
    it('d', () => {
      // a comment
      \`x\`.length
    })
    it('e', () => {
      f()
    })
  })
})
`)
  assert(r)
  assert.deepEqual(r.code, [
    "import { any, assert, describe, isDeepEqual, isMatch, isMatchOnly, test } from 'ubqtest'",
    '// TODO(ubq): An ES module has no require. Use an import statement, await',
    "// import('name'), or createRequire(import.meta.url) of node:module.",
    'const cjs = { require }',
    '// TODO(ubq): ubq has no test.skip and no test.only. For a function that',
    "// skips a test: (name: string, fn: () => void) => test(name, { skip: 'the",
    "// reason' }, fn).",
    'export const maybe = (old: boolean) => (old ? test.skip : test)',
    'let state: number',
    "describe('g', () => {",
    '  const setup = () => {',
    '    reset()',
    '  }',
    "  test('a', () => {",
    '    setup();',
    '    (globalThis as any).ids = 1',
    '    assert.equal(x instanceof Foo, false)',
    '    // TODO(ubq): ubq has no types of jest or vitest. A spy has the type',
    "    // Spy<F> of 'ubqtest': import { type Spy } from 'ubqtest'. For an",
    '    // object of spies, give each key its type: { load:',
    "    // Spy<Service['load']> }. A function that returns the object gives the",
    '    // types with no annotation: const make = () => ({ load: spy(async ()',
    '    // => user) }).',
    '    const m = fn as Mock',
    '    assert.equal(listener.calls.map(call => call.this)[0], 1)',
    "    assert(s.calls.some(call => isMatch(call.args, [{ a: 1, b: any.number }, 'c'])))",
    '    assert(!s.calls.some(call => isMatch(call.args, [any.defined])))',
    '    assert(s.calls.some(call => isMatchOnly(call.args, [{ a: 1 }, any.defined])))',
    '    // TODO(ubq): ubq has no expect. In a pattern, a partial object does',
    '    // the work of objectContaining, a RegExp does the work of',
    '    // stringContaining and stringMatching, and the object any of ubqtest',
    '    // does the work of the other matchers: any.number,',
    '    // any.instanceOf(URL), any.defined, any.arrayWith(a, b). A pattern is',
    '    // the second argument of assert.match, and of assert.matchOnly, which',
    '    // permits no key that the pattern does not have. assert.deepEqual',
    '    // compares a function as a value: change it to assert.matchOnly. An',
    '    // array in a pattern must have the length of the value: for some',
    '    // elements, any.arrayWith. For a call of a spy with arguments of a',
    '    // shape: assert(s.calls.some(call => isMatch(call.args, [pattern]))).',
    '    assert(s.calls.some(call => isDeepEqual(call.args, [expect.objectContaining({ a: { b: 1 } })])))',
    '    assert.match(s.calls[1]?.args, [/x/])',
    '    assert.equal(s.calls.length, 1)',
    '    assert.match(s.calls[0]?.args, [any.instanceOf(Foo)])',
    '    assert.match(x, { a: [1, any.defined] })',
    '    assert(!isMatch(x, any.string))',
    '    assert.match(x, { a: { b: undefined } })',
    '    assert(s.calls.some(call => isMatch(call.args, [-1, any.number])))',
    '    // TODO(ubq): ubq has no expect. In a pattern, a partial object does',
    '    // the work of objectContaining, a RegExp does the work of',
    '    // stringContaining and stringMatching, and the object any of ubqtest',
    '    // does the work of the other matchers: any.number,',
    '    // any.instanceOf(URL), any.defined, any.arrayWith(a, b). A pattern is',
    '    // the second argument of assert.match, and of assert.matchOnly, which',
    '    // permits no key that the pattern does not have. assert.deepEqual',
    '    // compares a function as a value: change it to assert.matchOnly. An',
    '    // array in a pattern must have the length of the value: for some',
    '    // elements, any.arrayWith. For a call of a spy with arguments of a',
    '    // shape: assert(s.calls.some(call => isMatch(call.args, [pattern]))).',
    '    assert(s.calls.some(call => isDeepEqual(call.args, [expect.any(), 1])))',
    '    // TODO(ubq): ubq has no expect. In a pattern, a partial object does',
    '    // the work of objectContaining, a RegExp does the work of',
    '    // stringContaining and stringMatching, and the object any of ubqtest',
    '    // does the work of the other matchers: any.number,',
    '    // any.instanceOf(URL), any.defined, any.arrayWith(a, b). A pattern is',
    '    // the second argument of assert.match, and of assert.matchOnly, which',
    '    // permits no key that the pattern does not have. assert.deepEqual',
    '    // compares a function as a value: change it to assert.matchOnly. An',
    '    // array in a pattern must have the length of the value: for some',
    '    // elements, any.arrayWith. For a call of a spy with arguments of a',
    '    // shape: assert(s.calls.some(call => isMatch(call.args, [pattern]))).',
    '    assert(s.calls.some(call => isDeepEqual(call.args, [[, 1], expect.anything()])))',
    '    // TODO(ubq): A spy gets its implementation as an argument: spy(impl),',
    '    // spyOn(object, key, impl). For a result that changes, the',
    '    // implementation reads a variable: let result = 1; const s = spy(() =>',
    '    // result). For a different result in each call: spy.results(a, b), or',
    '    // for an async function spy.results(Promise.resolve(a),',
    '    // Promise.reject(error)). A call after the last result throws. A call',
    '    // is spy.calls[i]: { args, result, error }.',
    '    assert.equal(s.mock.invocationCallOrder[0], 1)',
    '    // TODO(ubq): Use await clock.tick(ms), with the clock of fakeClock().',
    '    // A timer of 0 ms runs after 1 ms, as in Node: for a time of 0, use',
    '    // clock.tick(1).',
    '    vi.advanceTimersByTime(0)',
    '  })',
    "  describe('h', () => {",
    '    // TODO(ubq): ubq has no hooks. Make a setup function and call it in',
    '    // each test. Use cleanup() for the work after a test. Each test of',
    '    // this group calls setup() at its start, and that work ran before this',
    '    // hook. Call the new function after setup().',
    '    beforeEach(() => {',
    '      state = 1',
    '    })',
    "    test('b', () => { setup() })",
    '  })',
    '  for (const [i, [a, b, c]] of ([',
    "    ['a', { n: 1 }, undefined],",
    '    [undefined, { n: 2 }, 3],',
    '  ] satisfies [unknown, unknown, unknown][]).entries()) test(`each ${i}`, () => {',
    '    setup()',
    '    assert.equal(f(a, b), c)',
    '  })',
    '  for (const [a, b] of [',
    "    ['a', undefined],",
    "    ['b', 1],",
    '  ] as const) test(`plain ${a}`, () => {',
    '    setup()',
    '    assert.equal(f(a), b)',
    '  })',
    '})',
    "describe('k', () => {",
    '  // TODO(ubq): ubq has no hooks. Make a setup function and call it in each',
    '  // test. Use cleanup() for the work after a test. The function setup2 of',
    '  // a group in this scope does not do the work of this hook. Call the new',
    '  // function at the start of setup2.',
    '  beforeEach(() => {',
    '    state = 2',
    '  })',
    "  describe('l', () => {",
    '    const setup2 = () => {',
    '      reset()',
    '    }',
    "    test('c', () => {",
    '      setup2();',
    '      [1].forEach(f)',
    '    })',
    "    test('d', () => {",
    '      setup2();',
    '      // a comment',
    '      `x`.length',
    '    })',
    "    test('e', () => {",
    '      setup2()',
    '      f()',
    '    })',
    '  })',
    '})',
  ])
})

test('vitest: an exact comparison with a matcher is matchOnly, the this value of a call, and a tick in a callback', () => {
  const r = convert(`import { expect, it, vi } from 'vitest'
it('a', () => {
  expect(e).toEqual({ id: 1, time: expect.any(Number), user: { name: expect.stringContaining('a') } })
  expect(e).not.toEqual({ id: expect.anything() })
  expect(e).toEqual({ ...base, list: [expect.any(String), other] as unknown[] })
  expect(e).toEqual({ id: 1, part: expect.objectContaining({ a: 1 }) })
  expect(e).toEqual({ id: 1, not: expect.not.stringContaining('a') })
  expect(e).toEqual(make(expect.any(Number)))
  expect(s).toHaveBeenCalledWith({ id: 1 }, expect.anything())
  expect(s).toHaveBeenLastCalledWith({ id: expect.any(Number) })
  expect(s).toHaveBeenNthCalledWith(1, [{ id: expect.any(Number) }])
  expect(s.mock.contexts[0]).toBe(self)
  expect(s.mock.instances).toEqual([self])
  run(() => {
    vi.advanceTimersByTime(10)
  })
  vi.advanceTimersByTime(10)
  run(async () => {
    vi.runAllTimers()
  })
  emitter.on('x', () => {
    vi.runOnlyPendingTimers()
  })
  expect(e).toEqual({ list: [...rest, expect.any(Number)] })
  expect(e).toEqual({ list: [...expect.arrayContaining([1])] })
})
it.each([1])('each %s', () => {
  vi.runAllTimers()
})
`)
  assert(r)
  assert.deepEqual(r.code, [
    "import { any, assert, isMatchOnly, test } from 'ubqtest'",
    "test('a', () => {",
    '  assert.matchOnly(e, { id: 1, time: any.number, user: { name: /a/ } })',
    '  assert(!isMatchOnly(e, { id: any.defined }))',
    '  assert.matchOnly(e, { ...base, list: [any.string, other] as unknown[] })',
    '  // TODO(ubq): ubq has no expect. In a pattern, a partial object does the',
    '  // work of objectContaining, a RegExp does the work of stringContaining',
    '  // and stringMatching, and the object any of ubqtest does the work of the',
    '  // other matchers: any.number, any.instanceOf(URL), any.defined,',
    '  // any.arrayWith(a, b). A pattern is the second argument of assert.match,',
    '  // and of assert.matchOnly, which permits no key that the pattern does',
    '  // not have. assert.deepEqual compares a function as a value: change it',
    '  // to assert.matchOnly. An array in a pattern must have the length of the',
    '  // value: for some elements, any.arrayWith. For a call of a spy with',
    '  // arguments of a shape: assert(s.calls.some(call => isMatch(call.args,',
    '  // [pattern]))).',
    '  assert.deepEqual(e, { id: 1, part: expect.objectContaining({ a: 1 }) })',
    '  // TODO(ubq): ubq has no expect. In a pattern, a partial object does the',
    '  // work of objectContaining, a RegExp does the work of stringContaining',
    '  // and stringMatching, and the object any of ubqtest does the work of the',
    '  // other matchers: any.number, any.instanceOf(URL), any.defined,',
    '  // any.arrayWith(a, b). A pattern is the second argument of assert.match,',
    '  // and of assert.matchOnly, which permits no key that the pattern does',
    '  // not have. assert.deepEqual compares a function as a value: change it',
    '  // to assert.matchOnly. An array in a pattern must have the length of the',
    '  // value: for some elements, any.arrayWith. For a call of a spy with',
    '  // arguments of a shape: assert(s.calls.some(call => isMatch(call.args,',
    '  // [pattern]))).',
    "  assert.deepEqual(e, { id: 1, not: expect.not.stringContaining('a') })",
    '  // TODO(ubq): ubq has no expect. In a pattern, a partial object does the',
    '  // work of objectContaining, a RegExp does the work of stringContaining',
    '  // and stringMatching, and the object any of ubqtest does the work of the',
    '  // other matchers: any.number, any.instanceOf(URL), any.defined,',
    '  // any.arrayWith(a, b). A pattern is the second argument of assert.match,',
    '  // and of assert.matchOnly, which permits no key that the pattern does',
    '  // not have. assert.deepEqual compares a function as a value: change it',
    '  // to assert.matchOnly. An array in a pattern must have the length of the',
    '  // value: for some elements, any.arrayWith. For a call of a spy with',
    '  // arguments of a shape: assert(s.calls.some(call => isMatch(call.args,',
    '  // [pattern]))).',
    '  assert.deepEqual(e, make(expect.any(Number)))',
    '  assert(s.calls.some(call => isMatchOnly(call.args, [{ id: 1 }, any.defined])))',
    '  assert.matchOnly(s.calls.at(-1)?.args, [{ id: any.number }])',
    '  assert.matchOnly(s.calls[0]?.args, [[{ id: any.number }]])',
    '  assert.equal(s.calls.map(call => call.this)[0], self)',
    '  assert.deepEqual(s.calls.map(call => call.this), [self])',
    '  run(() => {',
    '    // TODO(ubq): Use await clock.tick(ms), with the clock of fakeClock().',
    '    // A timer of 0 ms runs after 1 ms, as in Node: for a time of 0, use',
    '    // clock.tick(1). This call is in a callback that is not async. The',
    '    // functions of the clock return a promise, and a callback with await',
    '    // is async: the code that calls it then gets a promise. If you can,',
    '    // move this call and the code after it out of the callback, into the',
    '    // test, and return from the callback the values that this code needs.',
    '    // If the code must run in the callback, make the callback async only',
    '    // if the code under test awaits its callback.',
    '    vi.advanceTimersByTime(10)',
    '  })',
    '  // TODO(ubq): Use await clock.tick(ms), with the clock of fakeClock(). A',
    '  // timer of 0 ms runs after 1 ms, as in Node: for a time of 0, use',
    '  // clock.tick(1).',
    '  vi.advanceTimersByTime(10)',
    '  run(async () => {',
    '    // TODO(ubq): Use await clock.runAll(), with the clock of fakeClock().',
    '    vi.runAllTimers()',
    '  })',
    "  emitter.on('x', () => {",
    '    // TODO(ubq): Use await clock.runAll(), with the clock of fakeClock().',
    '    // This call is in a callback that is not async. The functions of the',
    '    // clock return a promise, and a callback with await is async: the code',
    '    // that calls it then gets a promise. If you can, move this call and',
    '    // the code after it out of the callback, into the test, and return',
    '    // from the callback the values that this code needs. If the code must',
    '    // run in the callback, make the callback async only if the code under',
    '    // test awaits its callback.',
    '    vi.runOnlyPendingTimers()',
    '  })',
    '  assert.matchOnly(e, { list: [...rest, any.number] })',
    '  // TODO(ubq): ubq has no expect. In a pattern, a partial object does the',
    '  // work of objectContaining, a RegExp does the work of stringContaining',
    '  // and stringMatching, and the object any of ubqtest does the work of the',
    '  // other matchers: any.number, any.instanceOf(URL), any.defined,',
    '  // any.arrayWith(a, b). A pattern is the second argument of assert.match,',
    '  // and of assert.matchOnly, which permits no key that the pattern does',
    '  // not have. assert.deepEqual compares a function as a value: change it',
    '  // to assert.matchOnly. An array in a pattern must have the length of the',
    '  // value: for some elements, any.arrayWith. For a call of a spy with',
    '  // arguments of a shape: assert(s.calls.some(call => isMatch(call.args,',
    '  // [pattern]))).',
    '  assert.deepEqual(e, { list: [...expect.arrayContaining([1])] })',
    '})',
    '// TODO(ubq): Use a for loop around test(). Each name must be different:',
    '// put the value or the index in the name. Use JSON.stringify for an',
    '// object: %s of an object is [object Object].',
    "it.each([1])('each %s', () => {",
    '  // TODO(ubq): Use await clock.runAll(), with the clock of fakeClock().',
    '  vi.runAllTimers()',
    '})',
  ])
})

test('bun:test: spyOn and mock with no object, a function with no rule, the list of calls, and text with values as the expected error', () => {
  const r = convert(`import { expect, expectTypeOf, mock, setDefaultTimeout, spyOn, test } from "bun:test";
import * as ns from "../src/ns";
setDefaultTimeout(30_000);
test("a", async () => {
  const reads = spyOn(ws, "read");
  const m = mock(() => 1);
  const paths = reads.mock.calls.map(([path]) => path);
  expect(reads.mock.lastCall).toEqual(["a"]);
  await expect(p).rejects.toThrow(\`crash after \${x} write\`);
  await expect(p).rejects.toThrow(\`plain text\`);
  expect(() => f()).toThrow(\`crash \${x}\`);
  expect(JSON.parse(text)).toContainEqual({ a: 1 });
  expect(x).toMatchObject({ a: expect.any(String) });
  const all = spyOn(ns, "read").mockReturnValue(1);
  spyOn(ws, "write").mockImplementation(() => 2);
  expect(typeof setDefaultTimeout).toBe("function");
  const one = mock().mockReturnValue(1);
  expectTypeOf(one).toBeFunction();
});
`)
  assert(r)
  assert.deepEqual(r.code, [
    'import { any, assert, isDeepEqual, spy, spyOn, test } from "ubqtest";',
    'import * as ns from "../src/ns";',
    '// TODO(ubq): ubq has no time limit for one file. Remove this call. Give',
    '// the limit to a group or to a test: describe(name, { timeout: ms }, fn),',
    '// test(name, { timeout: ms }, fn). For each test of the project: "timeout"',
    '// in "ubq" in package.json.',
    'setDefaultTimeout(30_000);',
    'test("a", async () => {',
    '  const reads = spyOn(ws, "read");',
    '  const m = spy(() => 1);',
    '  const paths = reads.calls.map(call => call.args).map(([path]) => path);',
    '  assert.deepEqual(reads.calls.at(-1)?.args, ["a"]);',
    '  await assert.rejects(p, { message: (v: unknown) => String(v).includes(`crash after ${x} write`) });',
    '  await assert.rejects(p, { message: (v: unknown) => String(v).includes(`plain text`) });',
    '  assert.throws(() => f(), { message: (v: unknown) => String(v).includes(`crash ${x}`) });',
    '  assert(JSON.parse(text).some((item: unknown) => isDeepEqual(item, { a: 1 })));',
    '  assert.match(x, { a: any.string });',
    '  // TODO(ubq): spyOn cannot replace an export of a module: ns is the',
    "  // module '../src/ns', and the code under test has its own import of it.",
    "  // Use mockImport: const subject = await mockImport(() => import('<the",
    "  // module under test>'), [[() => import('../src/ns'), { ...ns, read:",
    '  // spy(impl) }]]). Then call the code of subject, not of the import at',
    '  // the top of the file, and assert on the spy.',
    '  const all = spyOn(ns, "read").mockReturnValue(1);',
    '  spyOn(ws, "write", () => 2);',
    '  // TODO(ubq): ubq has no time limit for one file. Remove this call. Give',
    '  // the limit to a group or to a test: describe(name, { timeout: ms },',
    '  // fn), test(name, { timeout: ms }, fn). For each test of the project:',
    '  // "timeout" in "ubq" in package.json.',
    '  assert.equal(typeof setDefaultTimeout, "function");',
    '  const one = spy(() => 1);',
    '  // TODO(ubq): ubq has no expectTypeOf.',
    '  expectTypeOf(one).toBeFunction();',
    '});',
  ])
})

test('vitest: matchers become the functions of the object any, and arrayContaining becomes any.arrayWith', () => {
  const r = convert(`import { expect, it } from 'vitest'
it('a', () => {
  expect(x).toMatchObject({ a: expect.any(Number), b: expect.anything(), c: expect.any(URL), d: expect.any(Array), e: expect.any(Object) })
  expect(x).toEqual({ list: expect.arrayContaining([1, expect.objectContaining({ id: 7 })]), n: expect.any(Number) })
  expect(x).toEqual({ list: expect.arrayContaining([{ id: 7 }]) })
  expect(list).toEqual(expect.arrayContaining([expect.objectContaining({ id: 7 })]))
  expect(list).toEqual(expect.arrayContaining([]))
  expect(list).toContainEqual(expect.objectContaining({ id: 7 }))
  expect(list).not.toContainEqual(expect.objectContaining({ id: expect.any(String) }))
  expect(list).toContainEqual({ id: expect.any(String) })
  expect(s).toHaveBeenCalledWith(expect.arrayContaining(['a']), expect.any(Function))
})
`)
  assert(r)
  assert.deepEqual(r.code, [
    "import { any, assert, isMatch, isMatchOnly, test } from 'ubqtest'",
    "test('a', () => {",
    '  assert.match(x, { a: any.number, b: any.defined, c: any.instanceOf(URL), d: any.array, e: any.object })',
    '  assert.matchOnly(x, { list: any.arrayWith(1, { id: 7 }), n: any.number })',
    '  // TODO(ubq): ubq has no expect. In a pattern, a partial object does the',
    '  // work of objectContaining, a RegExp does the work of stringContaining',
    '  // and stringMatching, and the object any of ubqtest does the work of the',
    '  // other matchers: any.number, any.instanceOf(URL), any.defined,',
    '  // any.arrayWith(a, b). A pattern is the second argument of assert.match,',
    '  // and of assert.matchOnly, which permits no key that the pattern does',
    '  // not have. assert.deepEqual compares a function as a value: change it',
    '  // to assert.matchOnly. An array in a pattern must have the length of the',
    '  // value: for some elements, any.arrayWith. For a call of a spy with',
    '  // arguments of a shape: assert(s.calls.some(call => isMatch(call.args,',
    '  // [pattern]))).',
    '  assert.deepEqual(x, { list: expect.arrayContaining([{ id: 7 }]) })',
    '  assert.match(list, any.arrayWith({ id: 7 }))',
    '  assert.match(list, any.array)',
    '  assert(list.some((item: unknown) => isMatch(item, { id: 7 })))',
    '  assert(!list.some((item: unknown) => isMatch(item, { id: any.string })))',
    '  assert(list.some((item: unknown) => isMatchOnly(item, { id: any.string })))',
    "  assert(s.calls.some(call => isMatch(call.args, [any.arrayWith('a'), any.function])))",
    '})',
  ])
})

test('vitest: a file with its own value any keeps the matchers, with a TODO', () => {
  const r = convert(`import { expect, it } from 'vitest'
const any = 1
it('a', () => {
  expect(x).toMatchObject({ a: expect.any(Number), b: any })
})
`)
  assert(r)
  assert.deepEqual(
    r.code.filter(line => !/^\s*\/\/ (?!TODO)/.test(line)),
    [
      "import { assert, test } from 'ubqtest'",
      'const any = 1',
      "test('a', () => {",
      '  // TODO(ubq): ubq has no expect. In a pattern, a partial object does the',
      '  assert.match(x, { a: expect.any(Number), b: any })',
      '})',
    ],
  )
})

test('convert adds .ubq to the ignore files of formatters and linters', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  mkdirSync(join(p.dir, 'old'))
  const source = "import { expect, it } from 'vitest'\nit('a', () => expect(1).toBe(1))\n"
  writeFileSync(join(p.dir, 'old/a.test.ts'), source)
  writeFileSync(join(p.dir, '.prettierignore'), 'dist')
  writeFileSync(join(p.dir, '.eslintignore'), 'dist\n')
  writeFileSync(join(p.dir, '.oxfmtrc.json'), '{ "printWidth": 100 }')
  // A pattern that already leaves it out.
  writeFileSync(join(p.dir, '.oxlintrc.json'), '{ "ignorePatterns": ["/.ubq/"] }')
  // A config with a comment, a list that is not a list, and a config that is code.
  writeFileSync(join(p.dir, '.oxfmtrc.jsonc'), '{ // a comment\n}\n')
  writeFileSync(join(p.dir, 'eslint.config.js'), 'export default []\n')
  const lines = (...args: string[]): string[] =>
    p
      .ubq('convert', ...args)
      .out.split('\n')
      .filter(line => /\.ubq/.test(line))
  const note =
    'note: add .ubq to the files that .oxfmtrc.jsonc, eslint.config.js leave out. It has the store and the test folders of ubq.'
  assert.deepEqual(lines('--dry', 'old'), ['to add .ubq to .prettierignore, .eslintignore, .oxfmtrc.json', note])
  assert.equal(readFileSync(join(p.dir, '.prettierignore'), 'utf8'), 'dist')
  assert.deepEqual(lines('old'), ['added .ubq to .prettierignore, .eslintignore, .oxfmtrc.json', note])
  assert.equal(readFileSync(join(p.dir, '.prettierignore'), 'utf8'), 'dist\n.ubq\n')
  assert.equal(readFileSync(join(p.dir, '.eslintignore'), 'utf8'), 'dist\n.ubq\n')
  assert.equal(
    readFileSync(join(p.dir, '.oxfmtrc.json'), 'utf8'),
    '{\n  "printWidth": 100,\n  "ignorePatterns": [\n    ".ubq"\n  ]\n}\n',
  )
  assert.equal(readFileSync(join(p.dir, '.oxlintrc.json'), 'utf8'), '{ "ignorePatterns": ["/.ubq/"] }')
  // A second run: each file has it.
  writeFileSync(join(p.dir, 'old/a.test.ts'), source)
  writeFileSync(join(p.dir, '.oxfmtrc.jsonc'), '{ "ignorePatterns": "dist" }')
  assert.deepEqual(lines('old'), [note])
})
