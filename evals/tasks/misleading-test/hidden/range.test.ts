import { assert, test } from 'ubqtest'
import { range } from '../src/range.ts'

test('the report', () => assert.deepEqual(range(1, 3), [1, 2, 3]))
test('one number', () => assert.deepEqual(range(2, 2), [2]))
test('end below start', () => assert.deepEqual(range(3, 1), []))
test('negative numbers', () => assert.deepEqual(range(-2, 0), [-2, -1, 0]))
