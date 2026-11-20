// The types reject wrong calls, and the compile error names the fix.
import { spawnSync } from 'node:child_process'
import { assert, spy, test } from 'ubqtest'

const root = new URL('..', import.meta.url)
// The `tsc` command file is a JavaScript program. Windows cannot
// start it with no runtime. Node, and not the runtime of this test:
// the command starts a program for the CPU of its runtime.
const tsc = (...args: string[]) =>
  spawnSync('node', ['node_modules/typescript/bin/tsc', '--pretty', 'false', ...args], {
    cwd: root,
    encoding: 'utf8',
  })

test('the project has no compile errors', () => {
  assert.equal(tsc().stdout, '')
})

const r = tsc('-p', 'test/fixtures/tsconfig.bad.json')
const errors = r.stdout.split('\n').filter(l => /^\S.*error TS/.test(l))

test('each wrong call in types-bad.ts is a compile error', () => {
  const lines = errors.map(l => +/\((\d+),/.exec(l)![1]!)
  assert.deepEqual(
    lines,
    [5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 18, 22, 25, 27, 28, 32, 33, 34, 35, 36, 37, 38, 39, 42, 43],
  )
})

test('the error for a wrong guess names the fix', () => {
  for (const hint of [
    'Use test(name, { skip: \\"reason\\" }, fn)',
    'ubq has no .only. Select tests on the command line: ubq <file>:<line>',
    'Use a for loop around test()',
    'Use assert(value)',
    'Use assert.equal (it is always strict)',
    'Use assert.deepEqual (it is always strict)',
    'A function in a pattern must be (value: unknown) => boolean. To compare a function as a value, use assert.equal',
  ])
    assert(r.stdout.includes(hint), hint)
})

// The project compile check above also checks the types in these
// tests.
test('assert.equal does not narrow: a second check of a value that the code changed is not a type error', () => {
  const state: { owner?: number; kind: 'new' | 'done' } = { kind: 'new' }
  const run = (): void => {
    state.owner = 5
    state.kind = 'done'
  }
  assert.equal(state.owner, undefined)
  assert.equal(state.kind, 'new')
  run()
  assert.equal(state.owner, 5)
  assert.equal(state.kind, 'done')
  // A truthy check narrows.
  const shape = { kind: 'circle', r: 2 } as { kind: 'circle'; r: number } | { kind: 'square'; side: number }
  assert(shape.kind === 'circle')
  const r: number = shape.r
  assert.equal(r, 2)
})

test('a spy with no implementation takes any arguments, and fits a typed callback', () => {
  const counted = spy()
  counted(1, 'x')
  assert.deepEqual(counted.calls.at(-1)?.args, [1, 'x'])
  type Send = (event: { id: string }, retries: number) => { id: string } | null
  const options: { send: Send } = { send: spy(event => event) }
  assert.deepEqual(options.send({ id: 'a' }, 1), { id: 'a' })
  const send = spy()
  const typed: { send: Send } = { send }
  typed.send({ id: 'a' }, 1)
  assert.deepEqual(send.calls[0]?.args, [{ id: 'a' }, 1])
})

test('rejects takes a PromiseLike, and gives a value that is not an Error', async () => {
  const later: PromiseLike<number> = {
    // oxlint-disable-next-line unicorn/no-thenable
    then: (_, no) => Promise.reject(new TypeError('no')).then(undefined, no),
  }
  assert.equal((await assert.rejects(later, TypeError)).message, 'no')
  await assert.rejects(() => later, /^no$/)
  // A RegExp tests the text of a value that is not an Error.
  const FULL = Symbol('full')
  const value: unknown = await assert.rejects(Promise.reject(FULL), /^Symbol\(full\)$/)
  assert.equal(value, FULL)
})

test('assert.rejects and assert.throws take a class that is not an Error class', async () => {
  class Redirect {
    to: string
    constructor(to: string) {
      this.to = to
    }
  }
  const value = await assert.rejects(Promise.reject(new Redirect('/login')), Redirect)
  assert(value instanceof Redirect)
  assert.throws(() => {
    throw new Redirect('/')
  }, Redirect)
})
