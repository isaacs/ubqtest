import { assert, test } from 'ubqtest'

test('dies', () => {
  assert.equal(1, 1)
  process.kill(process.pid, 'SIGKILL')
})
