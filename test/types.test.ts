// The types reject wrong calls, and the compile error names the fix.
import { spawnSync } from 'node:child_process'
import { assert, test } from 'ubqtest'

const root = new URL('..', import.meta.url)
// The `tsc` command file is a shell script. Windows cannot start it.
const tsc = (...args: string[]) =>
  spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '--pretty', 'false', ...args], {
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
