// Coverage on Bun, through counters in the source.
import { spawnSync } from 'node:child_process'
import { cpSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { assert, describe, test } from 'ubqtest'
import { flatten } from '../src/coverage.ts'
import { COUNTERS, snapshot } from '../src/counters.ts'
import { instrument } from '../src/instrument.ts'
import { fixtures, resetStore } from './setup.ts'

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
    // The code that did not run: `never`, and the `2` in `a || 2`
    // (`a` is 1 there). Nothing else.
    const zero: string[] = []
    const flat = flatten([{ ranges: snapshot(result.regions, counts, true) }])
    for (let i = 0; i < flat.length; i += 3)
      if (!flat[i + 2]) zero.push(SAMPLE.slice(flat[i], flat[i + 1]))
    assert.deepEqual(zero, ["function never() { return 'never' }", '2'])
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
    assert.deepEqual(names(false), [src.indexOf('function b'), src.indexOf('2'), src.indexOf('3')])
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
      "src/calc.ts:15:24  () => 'other'",
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
    assert.equal(sh('bun', [cli, 'pass.ts', 'cov'], fixtures).at(-1), 'pass: 0 failed, 10 passed, 1 skipped')
    assert.deepEqual(sh('node', [cli, 'sql', "select coverage from test_file where tfile = 'pass.ts'"], fixtures), [
      '{"coverage":"full"}',
    ])
  })
})
