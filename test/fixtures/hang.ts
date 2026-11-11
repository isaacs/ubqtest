import { createServer } from 'node:net'
import { assert, test } from 'ubqtest'

test('never settles, nothing pending', async () => {
  assert.equal(1, 1)
  await new Promise(() => {})
})

test('times out with a server open', { timeout: 50 }, async () => {
  assert.equal(1, 1)
  const server = createServer().listen(0)
  await new Promise(() => {})
  server.close()
})

test('runs after the hangs', () => {
  assert.equal(1, 1)
})
