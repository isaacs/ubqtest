// Tests that change the process and do not put the change back.
import { assert, env, test } from 'ubqtest'

const cwd = process.cwd()

test('sets a variable', () => {
  process.env.LEAK_A = 'a'
  delete process.env.LEAK_B
  assert.equal(1, 1)
})

test('the variables are back', () => {
  assert.deepEqual([process.env.LEAK_A, process.env.LEAK_B], [undefined, 'b'])
  env({ LEAK_A: 'ok' })
})

test('changes the working directory', () => {
  process.chdir('..')
  assert.equal(1, 1)
})

test('the working directory is back', () => {
  assert.equal(process.cwd(), cwd)
})
