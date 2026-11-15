import { assert, test } from 'ubqtest'
import { formatCents, sum } from '../src/money.ts'

test('sum', () => {
  assert.equal(sum([100, 250]), 350)
})
test('formatCents: cents', () => {
  assert.equal(formatCents(1234), '$12.34')
  assert.equal(formatCents(5), '$0.05')
  assert.equal(formatCents(0), '$0.00')
})
test('formatCents: negative', () => {
  assert.equal(formatCents(-250), '-$2.50')
})
test('formatCents: thousands', () => {
  assert.equal(formatCents(123456789), '$1,234,567.89')
  assert.equal(formatCents(100000), '$1,000.00')
})
test('formatCents: not a safe integer', () => {
  assert.throws(() => formatCents(1.5), RangeError)
  assert.throws(() => formatCents(2 ** 60), RangeError)
})
