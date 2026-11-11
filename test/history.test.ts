// Questions about more than one stored run: history and diff.
import { appendFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { assert, test } from 'ubqtest'
import { project } from './setup.ts'

/** Output lines, with the time of each run removed. */
const lines = (out: string): string[] =>
  out.trimEnd().split('\n').map(l => l.replace(/\d{4}-\d\d-\d\d \d\d:\d\d:\d\d/, 'TIME').replace(/ +\d+\.\d ms/, ' N ms'))

test('history shows the result of a test in each run, and says if the test is flaky', () => {
  const p = project()
  const a = 'flip.ts > group > a'
  p.set('pass')
  p.ubq('flip.ts', 'pass.ts')
  p.ubq('pass.ts')
  let r = p.ubq('history', a)
  assert.deepEqual([r.code, r.err], [0, ''])
  assert.deepEqual(lines(r.out), ['run 1  TIME  pass N ms', '0 failed, 1 passed in 1 runs (times are UTC)'])

  // The code changes, and then the test fails: not flaky.
  appendFileSync(join(p.dir, 'flip.ts'), '\n// a change\n')
  p.set('fail')
  p.ubq('flip.ts')
  assert.deepEqual(lines(p.ubq('history', a).out), [
    'run 1  TIME  pass N ms',
    'run 3  TIME  fail N ms  expected values to be equal',
    '1 failed, 1 passed in 2 runs (times are UTC)',
  ])

  // The same code passes: flaky.
  p.set('pass')
  p.ubq(a)
  assert.deepEqual(lines(p.ubq('history', a).out).slice(-2), [
    '1 failed, 2 passed in 3 runs (times are UTC)',
    'flaky: the test passed in run 4 and failed in run 3, and the code that it loaded was the same in the two runs',
  ])
  // A test that did not change its result is not flaky.
  assert.equal(lines(p.ubq('history', 'flip.ts > c').out).at(-1), '0 failed, 2 passed in 2 runs (times are UTC)')

  assert.deepEqual([p.ubq('history').code, p.ubq('history', 'flip.ts > nope').err], [4, 'ubq: no stored result for test: flip.ts > nope\n'])
  assert.equal(
    p.ubq('history', 'flip.ts > group').err,
    'ubq: flip.ts > group is not a test. It contains these tests:\n  flip.ts > group > a\n  flip.ts > group > b\n',
  )
  rmSync(p.dir, { recursive: true })
})

test('diff shows the tests with a different status in two runs', () => {
  const p = project()
  p.set('pass')
  p.ubq('flip.ts', 'pass.ts')
  assert.deepEqual([p.ubq('diff').code, p.ubq('diff').err], [4, 'ubq: ubq diff needs two runs, and the store has runs 1 to 1\n'])
  p.set('fail')
  p.ubq('flip.ts')

  // No run numbers: the last run and the run before it.
  const r = p.ubq('diff')
  assert.deepEqual([r.code, r.err], [1, ''])
  assert.deepEqual(lines(r.out), [
    'fail flip.ts > group > a (was pass in run 1)',
    '  expected values to be equal',
    'run 1 to run 2: 1 new failures, 0 fixed, 2 the same, 6 only in run 1',
    'details: ubq failures 2',
  ])
  const back = p.ubq('diff', '2', '1')
  assert.deepEqual([back.code, lines(back.out)], [0, [
    'pass flip.ts > group > a (was fail in run 2)',
    'run 2 to run 1: 0 new failures, 1 fixed, 2 the same, 6 only in run 1',
  ]])

  // A failure of a test that did not run in the first run, and a file error.
  p.ubq('pass.ts')
  appendFileSync(join(p.dir, 'pass.ts'), '\nthrow new Error("at load")\n')
  p.ubq('flip.ts', 'pass.ts')
  const one = p.ubq('diff', '3')
  assert.deepEqual([one.code, lines(one.out)], [1, [
    'ERROR pass.ts (no error in run 3)',
    'fail flip.ts > group > a (did not run in run 3)',
    '  expected values to be equal',
    'run 3 to run 4: 1 new failures, 0 fixed, 1 new file errors, 6 the same, 3 only in run 4',
    'details: ubq failures 4',
  ]])
  assert.deepEqual(lines(p.ubq('diff', '4', '3').out), [
    'no error pass.ts (was ERROR in run 4)',
    'run 4 to run 3: 0 new failures, 0 fixed, 6 the same, 3 only in run 4',
  ])

  const err = (...args: string[]) => [p.ubq('diff', ...args).code, p.ubq('diff', ...args).err]
  assert.deepEqual(err('9'), [4, 'ubq: run 9 is not in the store: the store has runs 1 to 4\n'])
  assert.deepEqual(err('x'), [4, 'ubq: ubq diff needs run numbers, not: x\n'])
  assert.deepEqual(err('2', '2'), [4, 'ubq: ubq diff needs two different runs, not run 2 two times\n'])
  assert.deepEqual(err('1', '2', '3'), [4, 'ubq: ubq diff takes two run numbers at most\n'])
  rmSync(p.dir, { recursive: true })
})
