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
  assert.deepEqual(lines, [5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 18, 22, 25, 27, 28])
})

test('the error for a wrong guess names the fix', () => {
  for (const hint of [
    'Use test(name, { skip: \\"reason\\" }, fn)',
    'ubq has no .only. Select tests on the command line: ubq <file>:<line>',
    'Use a for loop around test()',
    'Use assert(value)',
    'Use assert.equal (it is always strict)',
    'Use assert.deepEqual (it is always strict)',
  ])
    assert(r.stdout.includes(hint), hint)
})

// The project compile check above also checks the types in these
// tests.
test('assert.equal narrows a literal union, and keeps a number a number', () => {
  const counted = spy()
  assert.equal(counted.calls.length, 0)
  counted(1, 'x')
  // A second check of a value that changed: not a type error.
  assert.equal(counted.calls.length, 1)
  const shape = { kind: 'circle', r: 2 } as { kind: 'circle'; r: number } | { kind: 'square'; side: number }
  assert.equal(shape.kind, 'circle')
  const r: number = shape.r
  const maybe = 5 as number | undefined
  assert.equal(maybe, 5)
  const sure: number = maybe
  let flag = false as boolean
  assert.equal(flag, false)
  flag = true
  assert.equal(flag, true)
  const none = undefined as string | undefined
  assert.equal(none, undefined)
  const gone: undefined = none
  const any = 5 as unknown
  assert.equal(any, 5)
  const five: 5 = any
  assert.deepEqual([r, sure, gone, five], [2, 5, undefined, 5])
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
