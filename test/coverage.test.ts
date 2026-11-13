// Per-test coverage, the store, and the queries.
import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { assert, test } from 'ubqtest'
import { fileURLToPath } from 'node:url'
import { flatten } from '../src/coverage.ts'
import { fixtures } from './setup.ts'

const cwd = `${fixtures}cov/`
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url))
const run = (cmd: string, ...args: string[]) => {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' })
  return { code: r.status, out: r.stdout.trimEnd().split('\n'), err: r.stderr }
}
const ubq = (...args: string[]) => run('node', cli, ...args)
const reset = () => rmSync(`${cwd}.ubq`, { recursive: true, force: true })

test('flatten gives the count of the innermost range', () => {
  const r = (startOffset: number, endOffset: number, count: number) => ({ startOffset, endOffset, count })
  assert.deepEqual(
    flatten([
      { ranges: [r(0, 100, 1)] },
      { ranges: [r(10, 40, 2), r(20, 30, 0)] },
      { ranges: [r(50, 60, 0)] },
    ]),
    [0, 10, 1, 10, 20, 2, 20, 30, 0, 30, 40, 2, 40, 50, 1, 50, 60, 0, 60, 100, 1],
  )
  assert.deepEqual(flatten([{ ranges: [r(5, 9, 1)] }, { ranges: [r(20, 30, 3)] }]), [5, 9, 1, 20, 30, 3])
})

test('a run with preload has full coverage', () => {
  reset()
  const r = run('node', '--import', 'ubqtest/preload', 'test/calc.test.ts')
  assert.deepEqual(r, { code: 0, out: ['pass: 0 failed, 5 passed (run 1)'], err: '' })
  assert.deepEqual(ubq('uncovered').out, [
    "src/calc.ts:8:3  return 'fail'",
    'src/calc.ts:12:17  (): string => { (+2 lines)',
    "src/calc.ts:15:22  : () => 'other'",
    'src/calc.ts:18:8  function never(): number { (+3 lines)',
    '4 uncovered ranges in 1 of the 1 files that tests ran',
  ])
})

test('covers names the tests that ran a line', () => {
  assert.deepEqual(ubq('covers', 'src/calc.ts:1').out, [
    'test/calc.test.ts > add',
    // The load of the module makes the arrow function on line 1.
    'test/calc.test.ts (while the file loads)',
    '1 tests run src/calc.ts:1',
  ])
  assert.deepEqual(ubq('covers', 'src/calc.ts:5').out, ['test/calc.test.ts > grade A', '1 tests run src/calc.ts:5'])
  assert.deepEqual(ubq('covers', 'src/calc.ts:7').out, ['test/calc.test.ts > grade pass', '1 tests run src/calc.ts:7'])
  assert.deepEqual(ubq('covers', 'src/calc.ts:8').out, ['0 tests run src/calc.ts:8'])
  assert.deepEqual(ubq('covers', 'src/calc.ts:23').out, [
    'test/calc.test.ts (while the file loads)',
    '0 tests run src/calc.ts:23',
  ])
})

test('show, failures, and sql read the store', () => {
  assert.deepEqual(ubq('show', 'test/calc.test.ts > grade A').out.slice(0, 1), ['pass test/calc.test.ts > grade A'])
  assert.deepEqual(ubq('failures'), { code: 0, out: ['pass: 0 failed, 5 passed (run 1)'], err: '' })
  assert.deepEqual(ubq('sql', "select status, count(*) n from test group by status").out, ['{"status":"pass","n":5}'])
})

test('a new run of a test replaces its coverage', () => {
  run('node', '--import', 'ubqtest/preload', 'test/calc.test.ts')
  assert.deepEqual(ubq('covers', 'src/calc.ts:1').out, [
    'test/calc.test.ts > add',
    // The load of the module makes the arrow function on line 1.
    'test/calc.test.ts (while the file loads)',
    '1 tests run src/calc.ts:1',
  ])
  assert.deepEqual(ubq('sql', 'select count(distinct run) n from coverage').out, ['{"n":1}'])
})

test('a plain run states that coverage can be incomplete', () => {
  run('node', 'test/calc.test.ts')
  assert.match(ubq('uncovered').out.at(-1)!, /^note: coverage is not complete for 1 test files: test\/calc\.test\.ts \(partial\)/)
})

test('command errors exit with code 4', () => {
  assert.equal(ubq('covers', 'src/calc.ts').code, 4)
  assert.equal(ubq('nope').code, 4)
  assert.equal(ubq('show', 'no such test').code, 4)
  reset()
  assert.deepEqual(ubq('failures'), { code: 4, out: [''], err: 'ubq: no runs are stored. Run a test file first: node <test file>\n' })
})
