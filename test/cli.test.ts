// The command line: help, and the message for each wrong command.
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assert, cleanup, test } from 'ubqtest'
import { project } from './setup.ts'

test('help, and the error of each command with a wrong or absent argument', { timeout: 60_000 }, () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true, force: true }))
  const error = (...args: string[]): [number | null, string] => {
    const r = p.ubq(...args)
    return [r.code, r.err.trim()]
  }
  for (const flag of ['help', '--help', '-h']) {
    const r = p.ubq(flag)
    assert.deepEqual([r.code, r.out.split('\n')[0], r.out.includes('\n  ubq uncovered [file]')], [0, 'usage:', true])
  }
  // A command that reads the store, with no store.
  assert.deepEqual(error('failures'), [4, 'ubq: no runs are stored. Run a test file first: node <test file>'])
  assert.deepEqual(error('guide', 'nope'), [4, 'ubq: the guides are: ubq guide, ubq guide convert'])
  assert.deepEqual(error('browser'), [4, 'ubq: the command is: ubq browser install'])
  assert.deepEqual(error('browser', 'install'), [
    4,
    'ubq: the project does not have the playwright-core package. Run: npm install --save-dev playwright-core',
  ])
  assert.deepEqual(error('no-such-file.ts'), [4, 'ubq: no such file: no-such-file.ts'])

  // Two runs, with a test that has a skip reason and with 12 tests in one group.
  writeFileSync(
    join(p.dir, 'many.test.ts'),
    `import { assert, describe, test } from 'ubqtest'
describe('group', () => {
  for (let i = 0; i < 12; i++) test('n' + String(i).padStart(2, '0'), () => assert(true))
})
test('later', { skip: 'not now' }, () => assert(true))
`,
  )
  assert.equal(p.ubq().last, 'pass: 0 failed, 12 passed, 1 skipped')
  assert.equal(p.ubq().last, 'pass: 0 failed, 12 passed, 1 skipped')
  assert.deepEqual(error('covers'), [4, 'ubq: ubq covers needs <file>:<line>'])
  assert.deepEqual(error('covers', 'many.test.ts'), [4, 'ubq: ubq covers needs <file>:<line>'])
  assert.deepEqual(error('failures', '99'), [4, 'ubq: run 99 is not in the store'])
  assert.deepEqual(error('slow', '99'), [4, 'ubq: run 99 is not in the store'])
  assert.deepEqual(error('show'), [4, 'ubq: ubq show needs a test id'])
  assert.deepEqual(error('show', 'many.test.ts > nope'), [4, 'ubq: no stored result for test: many.test.ts > nope'])
  assert.deepEqual(error('history'), [4, 'ubq: ubq history needs a test id'])
  assert.deepEqual(error('uncovered', 'no-such-file.ts'), [4, 'ubq: no test loaded no-such-file.ts'])
  assert.deepEqual(error('diff', '9', '1'), [4, 'ubq: run 9 is not in the store: the store has runs 1 to 2'])
  assert.deepEqual(error('diff', '1', '1'), [4, 'ubq: ubq diff needs two different runs, not run 1 two times'])
  // A group is not a test. The message lists 10 of its tests.
  const group = error('history', 'many.test.ts > group')
  assert.deepEqual([group[0], group[1].split('\n').length, group[1].split('\n').at(-1)], [4, 12, '  and 2 more'])
  // A test with a skip reason.
  assert.deepEqual(p.ubq('show', 'many.test.ts > later').out.trimEnd().split('\n'), [
    'skip many.test.ts > later',
    '  run 2, 0 assertions, 0.0 ms',
    '  at many.test.ts:5',
    '  skip reason: not now',
  ])
  assert.match(p.ubq('history', 'many.test.ts > later').out, /\n0 failed, 0 passed, 2 skipped in 2 runs \(times are UTC\)\n$/)
  assert.deepEqual(p.ubq('failures', '1').out, 'pass: 0 failed, 12 passed, 1 skipped (run 1)\n')
})
