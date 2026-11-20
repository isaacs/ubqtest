// assert.contains and assert.notContains: a failure shows the text
// or the elements, and in long text, the part near the place.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assert, cleanup, test } from 'ubqtest'
import { project, remove } from './setup.ts'

test('contains and notContains on text and on iterables', () => {
  const p = project()
  cleanup(() => remove(p.dir))
  writeFileSync(
    join(p.dir, 'c.test.ts'),
    `import { assert, test } from 'ubqtest'
const page = '<html>' + 'x'.repeat(2000) + '<p>hello, world</p>' + 'y'.repeat(2000) + '</html>'
test('pass', () => {
  assert.contains('hello', 'ell')
  const list: ('a' | 'b')[] = ['a']
  assert.contains(list, 'a')
  assert.contains(new Set([1, NaN]), NaN)
  assert.notContains('hello', 'x')
  assert.notContains([1, 2], 3)
})
test('short text', () => assert.contains('hello, world', 'hello, there'))
test('long text', () => assert.contains(page, 'hello, there'))
test('array', () => assert.contains([1, 2], 3))
test('not text', () => assert.notContains(page, 'hello'))
test('not array', () => assert.notContains(['a', 'b'], 'b'))
test('undefined', () => assert.contains(undefined as string | undefined, 'a'))
`,
  )
  const blocks = p
    .ubq('c.test.ts')
    .out.split('\n\n')
    .map(block => block.split('\n').filter(line => !/^ {2}(at|>|rerun:) /.test(line)))
  assert.deepEqual(blocks[0], [
    'FAIL c.test.ts > short text',
    '  expected the text to contain the expected text',
    "  actual:   'hello, world'",
    "  expected: 'hello, there'",
    '  note: the first 7 characters of the expected text are at index 0',
  ])
  // 400 characters of the page, from 100 before the closest match.
  assert.match(blocks[1]![2]!, /^ {2}actual: {3}'x{97}<p>hello, world<\/p>y+'$/)
  assert.deepEqual(blocks[1]!.slice(3), [
    "  expected: 'hello, there'",
    '  note: the first 7 characters of the expected text are at index 2009; this is characters 1909 to 2309 of 4032',
  ])
  assert.deepEqual(blocks[2], [
    'FAIL c.test.ts > array',
    '  expected an element that is the expected value',
    '  actual:   [ 1, 2 ]',
    '  expected: 3',
  ])
  assert.equal(blocks[3]![1], '  expected the text not to contain the expected text, it is at index 2009')
  assert.equal(blocks[3]!.at(-1), '  note: this is characters 1909 to 2309 of 4032')
  assert.equal(blocks[4]![1], '  expected no element that is the expected value, it is at index 1')
  assert.deepEqual(blocks[5], ['FAIL c.test.ts > undefined', '  expected text or an iterable, got undefined'])
  assert.equal(blocks.at(-1)!.at(-2), 'fail: 6 failed, 1 passed (run 1: ubq failures 1)')
})
