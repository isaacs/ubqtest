import { assert, test } from 'ubqtest'
import { add, grade, outer, TOP } from '../src/calc.ts'

test('add', () => {
  assert.equal(add(1, 2), 3)
})

test('grade A', () => {
  assert.equal(grade(95), 'A')
})

test('grade pass', () => {
  assert.equal(grade(60), 'pass')
})

test('outer, inner not called', () => {
  assert.equal(typeof outer(true), 'function')
})

test('top', () => {
  assert.deepEqual(TOP, [2, 4, 6])
})
