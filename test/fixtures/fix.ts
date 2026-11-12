// Fixtures and spies. Each test prints what the test before it left.
import { existsSync, readFileSync } from 'node:fs'
import { assert, cleanup, env, spy, spyOn, test, testdir } from 'ubqtest'

const api = { double: (n: number) => n * 2 }
const log: string[] = []
const top = testdir({ 'top.txt': 'top' })
cleanup(() => console.log('file cleanup', existsSync(top), log.join(' ')))
let dir = ''

test('fixtures', () => {
  dir = testdir({ 'a.txt': 'hi', sub: { 'b.json': '{}' }, 'deep/c.txt': 'c' })
  assert.equal(readFileSync(`${dir}/a.txt`, 'utf8') + readFileSync(`${dir}/sub/b.json`, 'utf8') + readFileSync(`${dir}/deep/c.txt`, 'utf8'), 'hi{}c')
  assert.match(testdir(), /fixtures-2$/)
  env({ FIX_A: 'set', FIX_B: undefined })
  assert.deepEqual([process.env.FIX_A, process.env.FIX_B], ['set', undefined])
  cleanup(() => void log.push('first'))
  cleanup(async () => void log.push('second'))
  const double = spyOn(api, 'double')
  assert.equal(api.double(2), 4)
  spyOn(api, 'double', n => n * 3)
  assert.equal(api.double(2), 6)
  assert.deepEqual(double.calls, [{ args: [2], result: 4 }])
})

test('after a pass', () => {
  assert.deepEqual([log.join(' '), existsSync(dir), process.env.FIX_A, process.env.FIX_B], ['second first', false, undefined, 'b'])
  assert.equal(api.double(2), 4)
  assert.equal(Object.hasOwn(api, 'double'), true)
})

test('a failure keeps the folder', () => {
  dir = testdir({ 'kept.txt': 'kept' })
  assert.equal(1 as number, 2)
})

test('after a failure', () => {
  assert.equal(readFileSync(`${dir}/kept.txt`, 'utf8'), 'kept')
})

test('a cleanup that throws', () => {
  cleanup(() => {
    throw new Error('bad cleanup')
  })
  cleanup(() => void log.push('third'))
  assert.equal(1, 1)
})

test('a cleanup after the end', async () => {
  setTimeout(() => cleanup(() => {}), 5)
  assert.equal(log.at(-1), 'third')
})

test('spies', async () => {
  const add = spy((a: number, b: number) => a + b)
  assert.equal(add(1, 2), 3)
  const bad = spy(() => {
    throw new RangeError('no')
  })
  assert.throws(bad, RangeError)
  assert.deepEqual(add.calls, [{ args: [1, 2], result: 3 }])
  assert.equal(bad.calls[0]?.error instanceof RangeError, true)
  const none = spy()
  none('x')
  assert.deepEqual(none.calls, [{ args: ['x'], result: undefined }])
  await new Promise(r => setTimeout(r, 20))
})
