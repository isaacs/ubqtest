import { assert, test } from 'ubqtest'

console.log('printed while the file loads')

test('passes and prints', () => {
  console.log('from a test that passes')
  assert.equal(1, 1)
})

test('fails and prints', async () => {
  console.log('step 1: start')
  await new Promise(resolve => setTimeout(resolve, 2))
  console.error('step 2: about to fail')
  assert.equal(1 as number, 2)
})
