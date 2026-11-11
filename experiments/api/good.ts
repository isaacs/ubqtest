import { test, describe, assert, spy, testdir, mockImport } from './ubq.ts'
import { parse } from './src/greet.ts'

describe('parse', () => {
  test('circle', () => {
    const shape = parse('c')
    assert(shape)                       // narrows away undefined
    assert.equal(shape.kind, 'circle')  // narrows the union
    assert.equal(shape.r, 1)
  })
  test('unknown input', { timeout: 100 }, () => {
    assert.equal(parse('x'), undefined)
  })
  for (const [input, kind] of [['c', 'circle'], ['s', 'square']] as const) {
    test(`kind of ${input}`, () => { assert.match(parse(input), { kind }) })
  }
})

test('greet uses the db', async () => {
  const fetchUser = spy(async (id: number) => ({ id, name: 'ada' }))
  const { greet } = await mockImport(() => import('./src/greet.ts'), [
    [() => import('./src/db.ts'), { fetchUser }],
  ])
  assert.equal(await greet(7), 'hello ada')
  assert.deepEqual(fetchUser.calls[0]?.args, [7])
  const err = await assert.rejects(greet(NaN), /bad id/)
  assert.match(err.message, /bad/)
  const dir: string = testdir({ 'a.txt': 'hi', sub: { 'b.json': '{}' } })
  assert.match(dir, /./)
})
