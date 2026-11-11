// Fails or passes by the content of a file, so that a test can
// change the result between runs.
import { readFileSync } from 'node:fs'
import { assert, describe, test } from 'ubqtest'

const want = readFileSync(process.env.FLIP_FILE!, 'utf8')

describe('group', () => {
  test('a', () => {
    assert.equal(want, 'pass')
  })
  test('b', () => {
    assert.equal(1, 1)
  })
})

test('c', () => {
  assert.equal(1, 1)
})
