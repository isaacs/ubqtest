import { assert, describe, test } from 'ubqtest'
import { both, Box, count, defaults, grade, guarded, kind, later, pick, table, total } from '../src/flow.ts'

describe('branches', () => {
  test('grade A', () => {
    assert.equal(grade(95), 'A')
  })
  test('grade pass', () => {
    assert.equal(grade(60), 'pass')
  })
  test('pick takes the first value', () => {
    assert.equal(pick(1, 2), 1)
  })
  test('both, with one value', () => {
    assert.equal(both(0, 1), 'one')
  })
  test('kind of a short string', () => {
    assert.equal(kind('ab'), 'short')
  })
  test('kind of a number', () => {
    assert.equal(kind(1), 'n')
  })
})

test('box', () => {
  assert.equal(new Box(2).map(n => n * 2).value, 4)
})

test('total stops at a tag', () => {
  assert.equal(total([{ id: 1 }, { id: 2, tags: ['a', 'stop', 'b'] }]), 2)
})

test('guarded catches a range error', () => {
  assert.equal(guarded(() => { throw new RangeError('x') }), 'range')
})

test('later resolves', async () => {
  assert.equal(await later(1), 'done')
})

test('count yields', () => {
  assert.deepEqual([...count(3)], [0, 1, 2])
})

test('defaults', () => {
  assert.equal(defaults(), 2)
})

test('table', () => {
  assert.equal(table.get('one')?.(), 1)
})
