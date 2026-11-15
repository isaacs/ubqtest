import { assert, test } from 'ubqtest'
import { invoice } from '../src/invoice.ts'

const pen = { name: 'pen', cents: 250, qty: 2 }
const pad = { name: 'pad', cents: 500, qty: 1 }
const bread = { name: 'bread', cents: 300, qty: 1, taxFree: true }

test('no tax free item', () => assert.deepEqual(invoice([pen, pad]), { subtotal: 1000, tax: 80, total: 1080 }))
test('one tax free item', () => assert.deepEqual(invoice([pen, bread]), { subtotal: 800, tax: 40, total: 840 }))
test('only tax free items', () => assert.deepEqual(invoice([bread]), { subtotal: 300, tax: 0, total: 300 }))
test('a quantity of a tax free item', () =>
  assert.deepEqual(invoice([pad, { ...bread, qty: 3 }]), { subtotal: 1400, tax: 40, total: 1440 }))
test('taxFree false', () =>
  assert.deepEqual(invoice([{ ...pad, taxFree: false }]), { subtotal: 500, tax: 40, total: 540 }))
test('no items', () => assert.deepEqual(invoice([]), { subtotal: 0, tax: 0, total: 0 }))
