import { assert, describe, test } from 'ubqtest'
import { load, parse } from './src/shape.ts'

describe('parse', () => {
  test('circle', () => {
    const shape = parse('c')
    assert(shape)
    assert.equal(shape.kind, 'circle')
    assert.equal(shape.r, 1)
  })

  test('unknown input', () => {
    assert.equal(parse('x'), undefined)
    const err = assert.throws(() => parse('?'), RangeError)
    assert.equal(err.message, 'unknown shape: ?')
  })

  for (const [input, kind] of [['c', 'circle'], ['s', 'square']] as const) {
    test(`kind of ${input}`, () => {
      assert.match(parse(input), { kind })
    })
  }
})

test('load', async () => {
  assert.deepEqual(await load('s'), { kind: 'square', side: 2 })
  await assert.rejects(load('x'), /no shape for x/)
  await assert.rejects(() => load('y'), { message: /no shape/ })
})

test('not on this platform', { skip: 'needs a GPU' }, () => {
  assert.fail('must not run')
})
