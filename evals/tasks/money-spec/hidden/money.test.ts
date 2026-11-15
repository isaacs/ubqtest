import { assert, test } from 'ubqtest'
import { formatCents, sum } from '../src/money.ts'

test('sum', () => assert.equal(sum([100, 250]), 350))
test('cents', () => assert.equal(formatCents(1234), '$12.34'))
test('small', () => assert.equal(formatCents(5), '$0.05'))
test('zero', () => assert.equal(formatCents(0), '$0.00'))
test('ten cents', () => assert.equal(formatCents(10), '$0.10'))
test('negative', () => assert.equal(formatCents(-250), '-$2.50'))
test('thousands', () => assert.equal(formatCents(123456789), '$1,234,567.89'))
test('exactly a thousand', () => assert.equal(formatCents(100000), '$1,000.00'))
test('negative thousands', () => assert.equal(formatCents(-100000), '-$1,000.00'))
test('not an integer', () => void assert.throws(() => formatCents(1.5), RangeError))
test('not safe', () => void assert.throws(() => formatCents(2 ** 60), RangeError))
test('not a number', () => void assert.throws(() => formatCents(Number.NaN), RangeError))
