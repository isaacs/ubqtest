// A call of node:assert counts as an assertion of the test (D139).
import nodeAssert, { strictEqual } from 'node:assert'
import strict from 'node:assert/strict'
import { assert, test } from 'ubqtest'

// Outside a test, a call counts for no test.
nodeAssert.ok(true)

test('a function of node:assert counts', () => {
  nodeAssert.strictEqual(1, 1)
})

test('a function of node:assert/strict counts', () => {
  strict.equal(1, 1)
})

// Bun and Deno do not change a named import of a builtin module.
test(
  'a named import counts on Node',
  { skip: !!(process.versions.bun || process.versions.deno) && 'Node only' },
  () => {
    strictEqual(1, 1)
  },
)

test('a failure of node:assert fails the test', () => {
  const error = assert.throws(() => nodeAssert.strictEqual(1, 2), nodeAssert.AssertionError)
  assert.match(error.message, /strictly equal/)
})
