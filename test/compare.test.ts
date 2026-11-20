// assert.greaterThan, assert.lessThan, and assert.close: a failure
// shows the value and the target.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assert, cleanup, test } from 'ubqtest'
import { project, remove } from './setup.ts'

test('greaterThan, lessThan, and close pass, and show the two values in a failure', () => {
  const p = project()
  cleanup(() => remove(p.dir))
  writeFileSync(
    join(p.dir, 'c.test.ts'),
    `import { assert, test } from 'ubqtest'
const staff = 0.93
test('pass', () => {
  assert.greaterThan(2, 1)
  assert.greaterThan(2n, 1)
  assert.lessThan(1, 2)
  assert.greaterThanOrEqual(2, 2)
  assert.lessThanOrEqual(2n, 2n)
  assert.close(1.234, 1.23)
  assert.close(1.0000004, 1, 6)
  assert.close(Infinity, Infinity)
  assert.close(7.4, 7, 0)
})
test('greater', () => assert.greaterThan(staff, 5))
test('greater, equal', () => assert.greaterThan(5, 5))
test('less', () => assert.lessThan(staff, 0.5, 'the staff'))
test('less, not a number', () => assert.lessThan(NaN, 1))
test('at least', () => assert.greaterThanOrEqual(staff, 1))
test('at most', () => assert.lessThanOrEqual(staff, 0.5, 'the staff'))
test('close', () => assert.close(1.24, 1.23))
test('close, with a precision', () => assert.close(1.000001, 1, 6, 'the ratio'))
const row: { n?: number; m: number | null } | undefined = { m: null }
test('at most, a value that is null', () => assert.lessThanOrEqual(row?.m, 5))
test('close, a value that is null', () => assert.close(row?.m, 0))
test('greater, a value that is not there', () => assert.greaterThan(row?.n, -1))
`,
  )
  const blocks = p
    .ubq('c.test.ts')
    .out.split('\n\n')
    .map(block => block.split('\n').filter(line => !/^ {2}(at|>|rerun:) /.test(line)))
  assert.deepEqual(blocks.slice(0, 8), [
    ['FAIL c.test.ts > greater', '  expected a value greater than the target', '  actual:   0.93', '  expected: > 5'],
    [
      'FAIL c.test.ts > greater, equal',
      '  expected a value greater than the target',
      '  actual:   5',
      '  expected: > 5',
    ],
    [
      'FAIL c.test.ts > less',
      '  the staff: expected a value less than the target',
      '  actual:   0.93',
      '  expected: < 0.5',
    ],
    [
      'FAIL c.test.ts > less, not a number',
      '  expected a value less than the target',
      '  actual:   NaN',
      '  expected: < 1',
    ],
    [
      'FAIL c.test.ts > at least',
      '  expected a value greater than the target, or equal to it',
      '  actual:   0.93',
      '  expected: >= 1',
    ],
    [
      'FAIL c.test.ts > at most',
      '  the staff: expected a value less than the target, or equal to it',
      '  actual:   0.93',
      '  expected: <= 0.5',
    ],
    ['FAIL c.test.ts > close', '  expected a value near the target', '  actual:   1.24', '  expected: 1.23 ± 0.005'],
    [
      'FAIL c.test.ts > close, with a precision',
      '  the ratio: expected a value near the target',
      '  actual:   1.000001',
      '  expected: 1 ± 5e-7',
    ],
  ])
  // The type takes a value that can be null or undefined, and such
  // a value fails: null is 0 in a comparison of JavaScript.
  assert.deepEqual(blocks.slice(8, 11), [
    [
      'FAIL c.test.ts > at most, a value that is null',
      '  expected a value less than the target, or equal to it',
      '  actual:   null',
      '  expected: <= 5',
    ],
    [
      'FAIL c.test.ts > close, a value that is null',
      '  expected a value near the target',
      '  actual:   null',
      '  expected: 0 ± 0.005',
    ],
    [
      'FAIL c.test.ts > greater, a value that is not there',
      '  expected a value greater than the target',
      '  actual:   undefined',
      '  expected: > -1',
    ],
  ])
  assert.equal(blocks.at(-1)!.at(-2), 'fail: 11 failed, 1 passed (run 1: ubq failures 1)')
})

test('a test that does not await, and that takes more than its time limit, fails', () => {
  const p = project()
  cleanup(() => remove(p.dir))
  writeFileSync(
    join(p.dir, 'slow.test.ts'),
    `import { assert, test } from 'ubqtest'
const work = (ms: number): void => {
  const end = performance.now() + ms
  while (performance.now() < end);
}
test('slow', { timeout: 50 }, () => {
  work(120)
  assert(true)
})
test('in its limit', () => {
  work(120)
  assert(true)
})
`,
  )
  const r = p.ubq('slow.test.ts')
  assert.match(
    r.out,
    /^FAIL slow\.test\.ts > slow\n {2}the test ended after \d+ ms, and its time limit is 50 ms\. If the test needs this time, give it a limit: test\(name, \{ timeout: ms \}, fn\)$/m,
  )
  assert.equal(r.last, 'fail: 1 failed, 1 passed')
})
