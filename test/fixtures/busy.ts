import { assert, test } from 'ubqtest'

const spin = (n: number): number => {
  let x = 0
  while (true) x += n
}

test('before', () => {
  assert.equal(1, 1)
})

test('loops forever', { timeout: 100 }, () => {
  assert.equal(spin(1), 0)
})

test('never runs', () => {
  assert.equal(1, 1)
})
