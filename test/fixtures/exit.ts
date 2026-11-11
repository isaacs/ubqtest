import { assert, test } from 'ubqtest'

test('before', () => {
  assert.equal(1, 1)
})

test('calls process.exit', () => {
  assert.equal(1, 1)
  process.exit(0)
})

test('never runs', () => {
  assert.equal(1, 1)
})
