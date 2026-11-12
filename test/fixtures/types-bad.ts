// Each call here must be a compile error. See test/types.ts.
import { assert, mockImport, spyOn, test } from 'ubqtest'
import { parse } from './src/shape.ts'

test.skip('x', () => {})
test.only('x', () => {})
test.todo('x')
test.each([1])('x', () => {})
test('types', () => {
  assert.ok(parse('c'))
  assert.strictEqual(1, 1)
  assert.deepStrictEqual(1, 1)
  assert.equal(parse('c')?.kind, 'triangle')
  assert.deepEqual(parse('c'), { kind: 'circle', r: '1' })
  assert.throws(() => parse('c'))
  assert.match(parse('c'), { r: 'one' })
  const shape = parse('c')
  shape.kind
})
test('mocks', async () => {
  await mockImport(() => import('./src/greet.ts'), [
    [() => import('./src/db.ts'), { fetchUser: async (id: string) => ({ id: 1, name: 'x' }) }],
  ])
  await mockImport(() => import('./src/greet.ts'), [
    [() => import('./src/db.ts'), { nope: 1 }],
  ])
  spyOn({ n: 1, f: () => 1 }, 'n')
  spyOn({ n: 1, f: () => 1 }, 'f', () => 'one')
})
