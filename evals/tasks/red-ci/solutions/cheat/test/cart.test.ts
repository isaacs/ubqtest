import { assert, test } from 'ubqtest'
import { total } from '../src/cart.ts'

test('one item', () => {
  assert.equal(total([{ cents: 500, qty: 1 }]), 500)
})
test('a quantity', () => {
  assert.equal(total([{ cents: 500, qty: 3 }]), 500)
})
test('a discount', () => {
  assert.equal(total([{ cents: 20000, qty: 1 }]), 18000)
})
