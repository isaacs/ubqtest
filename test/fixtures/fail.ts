import { assert, describe, test } from 'ubqtest'
import { load, parse } from './src/shape.ts'

describe('assertions', () => {
  test('equal', () => {
    assert.equal(parse('s')?.kind, 'circle')
  })

  test('equal on objects with the same content', () => {
    assert.equal(parse('c'), { kind: 'circle', r: 1 })
  })

  test('deepEqual', () => {
    const actual = { id: 1, items: [{ id: 1, tags: ['a', 'b'] }, { id: 2, tags: [] }], extra: true }
    assert.deepEqual<unknown>(actual, { id: 1, items: [{ id: 1, tags: ['a', 'c'] }, { id: 3, tags: [] }], name: 'x' })
  })

  test('match', () => {
    assert.match({ status: 500, body: { user: { name: 'bob' } } }, { status: 200, body: { user: { name: /^a/ } } })
  })

  test('long strings', () => {
    assert.equal('the quick brown fox jumps over the lazy dog, again and again', 'the quick brown fox jumps over the lazy cat, again and again')
  })

  test('throws the wrong error', () => {
    assert.throws(() => parse('?'), TypeError)
  })

  test('does not throw', () => {
    assert.throws(() => parse('c'), /unknown/)
  })

  test('a custom message', () => {
    assert(parse('x'), 'x must parse')
  })
})

describe('rules', () => {
  test('no assertions', () => {
    parse('c')
  })

  test('rejects without await', () => {
    assert.rejects(load('x'), /no shape/)
  })

  test('a caught assertion still fails', () => {
    try {
      assert.equal(1 as number, 2)
    } catch {}
    assert.equal(1, 1)
  })

  test('an error in the code under test', () => {
    parse('?')
  })

  test('timeout', { timeout: 20 }, async () => {
    await new Promise(() => setTimeout(() => {}, 1000))
  })

  test('an error in a callback', async () => {
    await new Promise(() => setTimeout(() => { throw new Error('in callback') }, 1))
  })

  test('an assertion after the end', () => {
    setTimeout(() => assert.equal(1, 1), 5)
    assert.equal(1, 1)
  })
})
