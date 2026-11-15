import { assert, test } from 'ubqtest'
import { sum } from '../src/money.ts'

test('sum', () => {
  assert.equal(sum([100, 250]), 350)
})
