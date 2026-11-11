import { test, assert, mockImport } from './ubq.ts'
import { parse } from './src/greet.ts'
test.skip('x', () => {})
test.only('x', () => {})
test('types', async () => {
  assert.ok(parse('c'))
  assert.strictEqual(1, 1)
  assert.equal(parse('c')?.kind, 'triangle')
  assert.deepEqual(parse('c'), { kind: 'circle', r: '1' })
  assert.throws(() => parse('c'))
  assert.match(parse('c'), { kind: 'triangle' })
  assert.match(parse('c'), { r: 'one' })
  assert.match('abc', 5)
  await mockImport(() => import('./src/greet.ts'), [
    [() => import('./src/db.ts'), { fetchUser: async (id: string) => ({ id: 1, name: 'x' }) }],
  ])
  await mockImport(() => import('./src/greet.ts'), [
    [() => import('./src/db.ts'), { nope: 1 }],
  ])
})
