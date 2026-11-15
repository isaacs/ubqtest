import { assert, test } from 'ubqtest'
import { formatCents, sum } from '../src/money.ts'

test('sum', () => {
  assert.equal(sum([100, 250]), 350)
})
test('formatCents', () => {
  assert(formatCents(1234).startsWith('$'))
})
