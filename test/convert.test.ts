// `ubq convert`: test files of a different test tool, as ubq tests.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { assert, cleanup, test } from 'ubqtest'
import { convertSource } from '../src/convert.ts'
import { project } from './setup.ts'

// The load hook of the counters loads the parser with `require`,
// while this file loads. A static import of the same module from
// this file is an error in Node (a cycle of `require` and `import`).
// Deno cannot load this module with `require`.
const { parse, children }: typeof import('../src/instrument.ts') =
  process.versions.deno ? await import('../src/instrument.ts') : createRequire(import.meta.url)('../src/instrument.ts')

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
    '// TODO(ubq): ubq has no hooks. Make a setup function and call it in each test. Use cleanup() for the work after a test.',
    't.beforeEach(() => {})',
    '// TODO(ubq): ubq needs each assertion in a test. Put this in a test().',
    'assert.equal(1, 1)',
  ])
  assert.deepEqual([r.framework, r.todos.map(t => t.line)], ['tap', [21, 23]])
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
    '    assert(![1].includes(2))',
    '    assert.throws(() => f(), /bad \\(x\\)/)',
    '    await assert.rejects(p, TypeError)',
    '    assert.equal(await p, 1)',
    '    const s = spy(() => 1)',
    '    assert.deepEqual(s.calls.at(-1)?.args, [1, 2])',
    '    // TODO(ubq): ubq has no toSatisfy. Write an assertion with assert, assert.equal, assert.deepEqual, or assert.match.',
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
  assert.deepEqual([jest?.framework, jest?.code[0], jest?.code[3]], ['jest', "import { assert, describe, test } from 'ubqtest'", '    assert.equal(1, 1)'])
  assert.equal(convert("import { x } from './x.ts'\nx()\n"), undefined)
  assert.equal(convert("import { expect } from 'chai'\ndescribe('g', () => { it('a', () => { expect(1).to.equal(1) }) })\n"), undefined)
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
  assert.deepEqual(dry.out.split('\n').slice(0, 2), ['converted old.ts (tap): 9 changes, 0 TODO', 'convert: 1 files to change, 0 TODO comments'])
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
  assert.equal(p.ubq('convert', 'old.ts').out, 'convert: 0 files changed, 0 TODO comments, 1 files with no known test tool (old.ts)\n')
  assert.deepEqual([p.ubq('convert').code, p.ubq('convert', 'nope').code], [4, 4])
  assert.match(p.ubq('guide', 'convert').out, /^# ubq guide: convert\n/)
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
    f.mockRestore()
    vi.restoreAllMocks()
  })
})
`)
  assert(r)
  const todo = (text: string): string => `// TODO(ubq): ${text}`
  const restore = todo('A spyOn spy goes back when its test ends. Remove this call, if the code after it does not need the real method: a second spyOn on a key replaces the first. ubq has no call that puts the method back before the test ends.')
  assert.deepEqual(r.code, [
    "import { assert, describe, spy, spyOn, test } from 'ubqtest'",
    '',
    '{ await migrate() }',
    todo('ubq has no hooks. At the top level of the file, cleanup(fn) runs fn when the file ends.'),
    'afterAll(() => close())',
    '',
    "describe('group', () => {",
    '  ' + todo('ubq has no hooks. Make a function that does this work one time, and await it at the start of each test of the group: let ready; const setup = () => (ready ??= work()).'),
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
    '    ' + todo('ubq has no toHaveProperty. Write an assertion with assert, assert.equal, assert.deepEqual, or assert.match.'),
    "    expect(o).toHaveProperty('a.b')",
    '    ' + restore,
    '    f.mockRestore()',
    '  })',
    '})',
  ])
})

test('vitest for Workers: the names of cloudflare:test', () => {
  const r = convert(`import { env, createExecutionContext, waitOnExecutionContext, createScheduledController, applyD1Migrations, SELF } from 'cloudflare:test'
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
    "// TODO(ubq): ubq has no 'cloudflare:test'. 'ubqtest/workers' has executionContext, scheduledController, and migrate. Write the test without the other names.",
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
  expect(() => f()).toThrow(message)
  expect(() => f()).toThrow(TypeError)
})
`)
  assert(r)
  assert.deepEqual(r.code, [
    "import { assert, test } from 'ubqtest'",
    "test('a', () => {",
    '  assert(!text.match(/re/))',
    "  assert(row.tags.includes('x'))",
    "  assert(rows[0]?.includes('x'))",
    "  assert((a?.b)?.includes('x'))",
    '  // TODO(ubq): ubq has no expect. In assert.match, a partial object does the work of objectContaining, and a RegExp does the work of stringContaining and stringMatching. For any(String), assert on typeof. For arrayContaining, assert on each element: assert(list.includes(x)), or assert(list.some(item => isDeepEqual(item, x))) for an object.',
    '  assert.deepEqual(res.json(), { count: expect.any(Number) })',
    '  assert.match(last, { content: /a\\.b/ })',
    '  // TODO(ubq): vitest and jest accept a string here. assert.throws needs an Error class, a RegExp, or a partial object. If this value is a string, make a RegExp from it.',
    '  assert.throws(() => f(), message)',
    '  assert.throws(() => f(), TypeError)',
    '})',
  ])
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
    '// TODO(ubq): If this only puts spies back, delete it, each assignment to restore, and each call of restore() or of the function that was assigned. Then remove that function from the helper that gives it. A spyOn spy goes back when its test ends, and a second spyOn on a key replaces the first. If it does other work: ubq has no hooks. Make a setup function and call it in each test. Use cleanup() for the work after a test.',
    'afterEach(() => restore())',
    '// TODO(ubq): ubq has no hooks. Put this code at the top level of the file, with await. It runs at this place, not later: put it after the declarations that it uses.',
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
        plugins: [cloudflareTest({ wrangler: { configPath: './second/wrangler.jsonc' } })],
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
  writeFileSync(join(p.dir, 'second/test/setup.ts'), "globalThis.x = 1\n")
  const old = "import { expect, it } from 'vitest'\n\nit('a', () => {\n  expect(1).toBe(1)\n})\n"
  writeFileSync(join(p.dir, 'worker/test/a.test.ts'), old)
  writeFileSync(join(p.dir, 'second/test/b.test.ts'), old)
  const workers = [
    { config: 'worker/wrangler.jsonc', include: ['worker/test/**/*.test.ts'], vars: { APP_ID: '12345', LIMIT: 3, FLAGS: { a: true } } },
    { config: 'second/wrangler.jsonc', include: ['second/test/**/*.test.ts'] },
  ]
  // doctor says that the conversion writes the key.
  writeFileSync(join(p.dir, 'worker/test/a.test.ts'), "import { env } from 'cloudflare:test'\n" + old)
  assert(p.ubq('doctor').out.includes('Do not add it by hand: "ubq convert" writes it to package.json, from vitest.config.ts.\n'))
  writeFileSync(join(p.dir, 'worker/test/a.test.ts'), old)

  assert.deepEqual(p.ubq('convert', 'worker', 'second').out.split('\n').slice(2, -2), [
    'convert: 2 files changed, 0 TODO comments, 2 files with no known test tool (second/test/setup.ts, worker/test/setup.ts)',
    'note: second/test/setup.ts is a setup file of vitest.config.ts. ubq has no setup files. Export its work as a function, and await that function at the top level of each test file. See "A Cloudflare Worker" in: ubq guide convert',
    'note: each test file now applies the D1 migrations (await migrate(...)). The setup file is not necessary: remove worker/test/setup.ts.',
    `wrote "ubq.workers" to package.json, from vitest.config.ts: "workers": ${JSON.stringify(workers)}`,
    'note: the binding SECRET of miniflare.bindings in vitest.config.ts is not a plain value. Add it to "vars" by hand.',
  ])
  assert.deepEqual(JSON.parse(readFileSync(join(p.dir, 'package.json'), 'utf8')).ubq, { workers })
  assert.deepEqual(readFileSync(join(p.dir, 'worker/test/a.test.ts'), 'utf8').split('\n').slice(0, 4), [
    "import { assert, test } from 'ubqtest'",
    "import { migrate } from 'ubqtest/workers'",
    '',
    "await migrate('DB')",
  ])
  assert.equal(readFileSync(join(p.dir, 'second/test/b.test.ts'), 'utf8').split('\n')[0], "import { assert, test } from 'ubqtest'")
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
    'converted old/a.test.ts (vitest): 2 changes, 3 TODO',
    '  old/a.test.ts:2  [1] ubq has no hooks.',
    '  old/a.test.ts:4  [2] Give the reason:',
    '  old/a.test.ts:6  [1] ubq has no hooks.',
    'converted old/helper.ts (vitest): 2 changes, 0 TODO',
    'hints:',
    '  [1] ubq has no hooks. Make a setup function and call it in each test. Use cleanup() for the work after a test.',
    "  [2] Give the reason: { skip: 'the reason' }.",
    'convert: 2 files to change, 3 TODO comments',
    'note: this command makes only the changes that are correct in each case. A TODO can be easy to do by hand: the command leaves it if the change is not safe for each program that has that form.',
    'next: read `ubq guide convert`, do each TODO(ubq), then run: ubq',
    '',
  ])
})

test('the parser reads type syntax that it does not know, with the types removed', { skip: !!process.versions.bun && 'Bun has no function that removes types' }, () => {
  // A `const` type parameter in an interface is an error for the parser.
  const source = "interface A {\n  m<const T>(a: T): void\n}\nexport const f = (a: number): number => a + 1\n"
  const tree = parse(source, 'a.ts')
  // The positions are those of the source.
  const last = (tree.body as { start: number; end: number }[]).at(-1)!
  assert.equal(source.slice(last.start, last.end), 'export const f = (a: number): number => a + 1')
  assert.throws(() => parse('const = 1', 'a.ts'), SyntaxError)
})
