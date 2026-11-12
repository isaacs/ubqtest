// Coverage on Bun, through counters in the source.
import { spawnSync } from 'node:child_process'
import { cpSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { assert, cleanup, describe, test } from 'ubqtest'
import { mapper } from '../src/bun-coverage.ts'
import { flatten } from '../src/coverage.ts'
import { COUNTERS, snapshot } from '../src/counters.ts'
import { addJsx, fixtures, project, resetStore } from './setup.ts'

// The load hook of the counters loads the parser with `require`,
// while this file loads. A static import of the same module from
// this file is an error in Node (a cycle of `require` and `import`).
const { instrument } = createRequire(import.meta.url)('../src/instrument.ts') as typeof import('../src/instrument.ts')

// Plain JavaScript with each construct that gets a counter. The
// value of `out` shows which paths ran.
const SAMPLE = `'use strict'
const out = []
function grade(n) {
  if (n > 90) return 'A'
  else if (n > 50) { return 'pass' }
  return 'fail'
}
const pick = (a, b) => a ?? b
const both = (a, b) => a && b ? 'both' : a || b ? 'one' : 'none'
class Box { constructor(v) { this.v = v } get twice() { return this.v * 2 } static of(v) { return new Box(v) } }
function kind(x) {
  switch (typeof x) {
    case 'number': return 'n'
    case 'string':
      out.push('s')
      break
    default: return 'other'
  }
  return 'string'
}
function loops(n) { let t = 0; for (let i = 0; i < n; i++) t += i; while (t > 5) t -= 5; do t++; while (t < 3); for (const k in { a: 1 }) t += k.length; for (const v of [1]) t += v; return t }
function guarded(f) { try { return f() } catch (e) { return 'caught ' + e.message } finally { out.push('finally') } }
function never() { return 'never' }
out.push(grade(95), grade(60), grade(1), pick(null, 2), pick(1, 2), both(1, 1), both(0, 1), both(0, 0))
out.push(Box.of(4).twice, kind(1), kind('a'), kind(null), loops(5), guarded(() => 1), guarded(() => { throw new Error('x') }))
out.push(((a = 1, { b = a || 2 } = {}) => a + b)(), [1, 2].map(n => n * 2).join())
globalThis.__sampleOut = out
`

const run = async (code: string): Promise<unknown> => {
  await import(`data:text/javascript,${encodeURIComponent(code)}`)
  return (globalThis as { __sampleOut?: unknown }).__sampleOut
}

describe('instrument', () => {
  test('the changed code gives the same result, and each line keeps its number', async () => {
    const result = instrument(SAMPLE, 'sample.js')
    assert(result)
    const counts = new Uint32Array(result.regions.length)
    ;(globalThis as Record<symbol, unknown>)[Symbol.for(COUNTERS)] = new Map([['sample.js', counts]])
    const expected = await run(SAMPLE + '// plain')
    assert.deepEqual(await run(result.code), expected)
    assert.equal(result.code.split('\n').length, SAMPLE.split('\n').length)
    // The code that did not run: `never`, and the `|| 2` in `a || 2`
    // (`a` is 1 there). Nothing else.
    const zero: string[] = []
    const flat = flatten([{ ranges: snapshot(result.regions, counts, true) }])
    for (let i = 0; i < flat.length; i += 3)
      if (!flat[i + 2]) zero.push(SAMPLE.slice(flat[i], flat[i + 1]))
    assert.deepEqual(zero, ["function never() { return 'never' }", ' || 2'])
  })

  test('a snapshot after the first lists only functions that ran', () => {
    const src = 'function a() { return 1 }\nfunction b(x) { return x ? 2 : 3 }\n'
    const result = instrument(src, 'f.js')
    assert(result)
    const counts = new Uint32Array(result.regions.length)
    const names = (all: boolean): number[] =>
      snapshot(result.regions, counts, all).map(r => r.startOffset)
    counts[0] = 1
    assert.equal(names(true).length, result.regions.length)
    // Only `b` ran: its region, and its two branches.
    const b = result.regions.findIndex(r => r.fn && r.start > 10)
    counts[b] = 1
    assert.deepEqual(names(false), [src.indexOf('function b'), src.indexOf(' ? 2'), src.indexOf(' : 3')])
    assert.deepEqual([...counts], [0, 0, 0, 0, 0])
  })

  test('source that the parser cannot read gives undefined', () => {
    assert.equal(instrument('const = 1', 'bad.js'), undefined)
  })

  test('TypeScript syntax stays in place', () => {
    const src = 'export const f = <T,>(x: T): T => x as T\nenum E { A }\n'
    const result = instrument(src, 'f.ts')
    assert(result)
    assert.match(result.code, /<T,>\(x: T\): T => \(__ubqc\[1\]\+\+,x as T\)\nenum E \{ A \}/)
  })
})

const bun = spawnSync('bun', ['--version']).status === 0
const skip = !bun && 'bun is not installed'
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url))
// A copy of the coverage fixture project. The tests in
// coverage.test.ts use the store of the original at the same time.
const cov = `${fixtures}.tmp-cov-bun/`
const sh = (cmd: string, args: string[], cwd: string) => {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' })
  return r.stdout.replace(/ \(run \d+\)\n$/, '\n').trimEnd().split('\n')
}

describe('bun', () => {
  test('coverage with the preload gives the same answers as V8', { skip }, () => {
    rmSync(cov, { recursive: true, force: true })
    // Not the store: coverage.test.ts can remove it during the copy.
    cpSync(`${fixtures}cov/`, cov, { recursive: true, filter: path => !path.endsWith('.ubq') })
    resetStore(cov)
    assert.deepEqual(sh('bun', ['--preload', 'ubqtest/bun-preload', 'test/calc.test.ts'], cov), [
      'pass: 0 failed, 5 passed',
    ])
    assert.deepEqual(sh('node', [cli, 'uncovered'], cov), [
      "src/calc.ts:8:3  return 'fail'",
      'src/calc.ts:12:17  (): string => { (+2 lines)',
      "src/calc.ts:15:22  : () => 'other'",
      'src/calc.ts:18:8  function never(): number { (+3 lines)',
      '4 uncovered ranges in 1 files',
    ])
    assert.deepEqual(sh('node', [cli, 'covers', 'src/calc.ts:5'], cov), [
      'test/calc.test.ts > grade A',
      '1 tests run src/calc.ts:5',
    ])
    assert.deepEqual(sh('node', [cli, 'covers', 'src/calc.ts:23'], cov), [
      'test/calc.test.ts (while the file loads)',
      '0 tests run src/calc.ts:23',
    ])
    rmSync(cov, { recursive: true })
  })

  test('the runner on bun runs one file and many files with full coverage', { skip }, () => {
    assert.deepEqual(sh('bun', [cli, 'pass.ts'], fixtures), [
      'skip pass.ts > not on this platform: needs a GPU',
      'pass: 0 failed, 5 passed, 1 skipped',
    ])
    assert.equal(sh('bun', [cli, 'pass.ts', 'cov/test/calc.test.ts'], fixtures).at(-1), 'pass: 0 failed, 10 passed, 1 skipped')
    assert.deepEqual(sh('node', [cli, 'sql', "select coverage from test_file where tfile = 'pass.ts'"], fixtures), [
      '{"coverage":"full"}',
    ])
  })

  // Known gap: on Windows, a mock on Bun does not replace the dependency.
  test('mockImport gives a new module instance with mocked dependencies', { skip: skip || (process.platform === 'win32' && 'mockImport on Bun does not work on Windows yet') }, () => {
    const p = project()
    cleanup(() => rmSync(p.dir, { recursive: true }))
    assert.deepEqual(sh('bun', [cli, 'mock.ts'], p.dir), [
      'FAIL mock.ts > a mock that lacks an export',
      '  Error: the mock of src/db.ts has no export "fetchUser", and the code under test imports it. Add "fetchUser" to the mock.',
      '  at mock.ts:29:9',
      "  > await mockImport(() => import('./src/greet.ts'), [[() => import('./src/db.ts'), { table: 'x' }]])",
      '  rerun: ubq mock.ts:28',
      '',
      'FAIL mock.ts > a loader that is not an import',
      "  TypeError: the first argument of mockImport must be an arrow function of the form () => import('...')",
      '  at mock.ts:35:9',
      '  > await mockImport(() => Promise.resolve(real), [])',
      '  rerun: ubq mock.ts:33',
      '',
      'fail: 2 failed, 2 passed',
    ])
    // Code that ran in a mocked instance is coverage of the real file.
    assert.deepEqual(sh('node', [cli, 'covers', 'src/word.ts:3'], p.dir), [
      'mock.ts > a mock reaches the modules that the module imports, and builtins',
      'mock.ts > a mock replaces a dependency in a new instance of the module',
      'mock.ts (while the file loads)',
      '2 tests run src/word.ts:3',
    ])
    // In a child process.
    assert.equal(sh('bun', [cli, 'mock.ts', 'pass.ts'], p.dir).at(-1), 'fail: 2 failed, 7 passed, 1 skipped')
  })

  test('the inspector of a plain program gives places in the source, from a guess', { skip }, () => {
    // Offsets in JavaScript with no types, to offsets in the source.
    const source = "// if (a) return\nexport function f(a: number): string {\n  if (a > 1) return 'big'\n  return 'small'\n}\n"
    const made = 'export function f(a) {\n  if (a > 1)\n    return "big";\n  return "small";\n}\n'
    const toSource = mapper(source, made)
    const place = (text: string) => [toSource(made.indexOf(text), false), toSource(made.indexOf(text) + text.length, true)]
    assert.deepEqual(place('return "big"'), [source.indexOf("return 'big'"), source.indexOf("return 'big'") + 12])
    assert.deepEqual(place('(a) {'), [source.indexOf('(a:'), source.indexOf('{') + 1])

    const p = project()
    cleanup(() => rmSync(p.dir, { recursive: true }))
    writeFileSync(join(p.dir, 'src/size.ts'), source + "export function never(): number {\n  return 1\n}\n")
    writeFileSync(
      join(p.dir, 'size.ts'),
      "import { assert, test } from 'ubqtest'\nimport { f } from './src/size.ts'\ntest('small', () => {\n  assert.equal(f(1), 'small')\n})\n",
    )
    // The runner gives its test processes a compile cache. Bun gives
    // no ranges for code from a cache, and a plain program has none.
    const plain = () => {
      const { NODE_COMPILE_CACHE: _, ...env } = process.env
      const r = spawnSync('bun', ['size.ts'], { cwd: p.dir, encoding: 'utf8', env })
      return r.stdout.replace(/ \(run \d+\)\n$/, '')
    }
    // Off by default: a plain program on Bun records no coverage.
    assert.equal(plain(), 'pass: 0 failed, 1 passed')
    assert.deepEqual(sh('node', [cli, 'covers', 'src/size.ts:4'], p.dir), ['0 tests run src/size.ts:4'])
    p.configure({ bunInspectorCoverage: true })
    assert.equal(plain(), 'pass: 0 failed, 1 passed')
    // The data of the inspector is not the same in each version of
    // Bun, so the places are not a part of this check. The store
    // must have the file that the test ran.
    assert.deepEqual(sh('node', [cli, 'sql', "select distinct file from coverage where file = 'src/size.ts'"], p.dir), [
      '{"file":"src/size.ts"}',
    ])
    // The runner uses counters, with or without the option.
    assert.deepEqual(sh('bun', [cli, 'size.ts'], p.dir), ['pass: 0 failed, 1 passed'])
    assert.deepEqual(sh('node', [cli, 'uncovered', 'src/size.ts'], p.dir), [
      "src/size.ts:3:14  return 'big'",
      'src/size.ts:6:8  function never(): number { (+2 lines)',
      '2 uncovered ranges in 1 files',
    ])
  })

  test('a .tsx file gets counters on Bun', { skip }, () => {
    const p = project()
    cleanup(() => rmSync(p.dir, { recursive: true }))
    addJsx(p.dir)
    assert.deepEqual(sh('bun', [cli, 'view.tsx'], p.dir), ['pass: 0 failed, 3 passed'])
    assert.deepEqual(sh('bun', [cli, 'uncovered', 'src/view.tsx'], p.dir), [
      'src/view.tsx:2:32  (type: unknown, props: unknown) => ({ type, props })',
      'src/view.tsx:8:35  ? <b>many</b>',
      'src/view.tsx:17:22  <T,>({ value }: { value: T }) => <i>{String(value)}</i>',
      '3 uncovered ranges in 1 files',
    ])
    assert.deepEqual(sh('bun', [cli, 'covers', 'src/view.tsx:12'], p.dir), [
      'view.tsx > a view of no items',
      'view.tsx > a view of two items',
      '2 tests run src/view.tsx:12',
    ])
    writeFileSync(
      join(p.dir, 'plain.ts'),
      "import { assert, test } from 'ubqtest'\nimport { Plain } from './src/plain.js'\ntest('on', () => {\n  assert.equal(Plain(true).type, 'b')\n})\n",
    )
    assert.deepEqual(sh('bun', [cli, 'plain.ts'], p.dir), ['pass: 0 failed, 1 passed'])
    assert.deepEqual(sh('bun', [cli, 'uncovered', 'src/plain.js'], p.dir), [
      'src/plain.js:1:44  : <i>off</i>',
      '1 uncovered ranges in 1 files',
    ])
    // The mutation check makes its changes in the JSX source.
    assert.deepEqual(sh('bun', [cli, 'mutate', 'src/view.tsx:5'], p.dir), ['mutate: 0 of 2 changes survived'])
  })
})
