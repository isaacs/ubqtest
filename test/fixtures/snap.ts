// Snapshots.
import { assert, describe, test } from 'ubqtest'

const text = process.env.SNAP_TEXT ?? 'one'

describe('group', () => {
  test('values', () => {
    assert.snapshot({ b: [1, 2], a: text, when: new Date(0), set: new Set(['x']) })
    assert.snapshot(`line 1\nline ${text}\nback\`tick \${x} \\ end`)
  })
})

test('text', () => {
  assert.snapshot(text)
})
