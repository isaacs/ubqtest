import { assert, test } from 'ubqtest'
import { total } from '../src/cart.ts'

test('one item', () => assert.equal(total([{ cents: 500, qty: 1 }]), 500))
test('a quantity', () => assert.equal(total([{ cents: 500, qty: 3 }]), 1500))
test('a discount', () => assert.equal(total([{ cents: 20000, qty: 1 }]), 18000))
test('a discount from a quantity', () => assert.equal(total([{ cents: 5000, qty: 2 }]), 9000))
test('just below the discount', () => assert.equal(total([{ cents: 9999, qty: 1 }]), 9999))
test('no items', () => assert.equal(total([]), 0))
