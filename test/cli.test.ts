// The command line: help, and the message for each wrong command.
import { spawnSync } from 'node:child_process'
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assert, cleanup, test } from 'ubqtest'
import { cli, project } from './setup.ts'

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
  // A run of one test: the others are not selected.
  p.ubq('many.test.ts > later')
  assert.equal(p.ubq('failures').last, 'fail: 0 failed, 0 passed, 1 skipped, 12 not selected')
  // A test that passed, and now is skipped, is an other change.
  writeFileSync(join(p.dir, 'many.test.ts'), "import { test } from 'ubqtest'\ntest('later', { skip: 'x' }, () => {})\n")
  p.ubq('many.test.ts')
  // A new failure is first in the list.
  writeFileSync(
    join(p.dir, 'many.test.ts'),
    "import { assert, test } from 'ubqtest'\ntest('later', () => assert(true))\ntest('broken', () => assert.equal(1, 2))\n",
  )
  p.ubq('many.test.ts')
  assert.deepEqual(p.ubq('diff').out.trimEnd().split('\n'), [
    'fail many.test.ts > broken (did not run in run 4)',
    '  expected values to be equal',
    'pass many.test.ts > later (was skip in run 4)',
    'run 4 to run 5: 1 new failures, 0 fixed, 1 other changes, 0 the same, 1 only in run 5',
    'details: ubq failures 5',
  ])
  assert.match(error('skill', 'nope')[1], /^ubq: unknown agent "nope"\. The agents are: claude, .* A folder also works: ubq skill \.myagent\/skills$/)
})

test('a file that ends the process, cut output, and a run of only skipped tests', { timeout: 60_000 }, () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true, force: true }))
  // No import of ubqtest: the runner must report the exit.
  writeFileSync(join(p.dir, 'exits.test.ts'), 'process.exit(3)\n')
  const exits = p.ubq('exits.test.ts')
  assert.deepEqual([exits.code, exits.out.split('\n').slice(0, 2)], [
    1,
    ['ERROR exits.test.ts', '  the test process ended before the file did (exit code 3)'],
  ])
  // No import of ubqtest, and no exit: the runner reports it too.
  writeFileSync(join(p.dir, 'exits.test.ts'), 'void 0\n')
  const plain = p.ubq('exits.test.ts')
  assert.deepEqual([plain.code, plain.out.split('\n').slice(0, 2)], [
    1,
    ['ERROR exits.test.ts', '  the test process ended before the file did (exit code 0)'],
  ])
  writeFileSync(
    join(p.dir, 'noisy.test.ts'),
    `import { assert, test } from 'ubqtest'
test('much output', () => {
  for (let i = 1; i <= 30; i++) console.log('line ' + i)
  assert.equal(1, 2)
})
`,
  )
  const noisy = p.ubq('noisy.test.ts')
  assert.match(noisy.out, /\n  output \(last 20 of 30 lines\):\n  \| line 11\n/)
  // In CI, the output is not cut.
  const ci = spawnSync('node', [cli, 'noisy.test.ts'], { cwd: p.dir, encoding: 'utf8', env: { ...process.env, CI: '1' } })
  assert.match(ci.stdout, /\n  output:\n  \| line 1\n/)
  assert.equal(ci.stdout.match(/^  \| line /gm)?.length, 30)
  writeFileSync(join(p.dir, 'skipped.test.ts'), "import { test } from 'ubqtest'\ntest('s', { skip: 'x' }, () => {})\n")
  const skipped = p.ubq('skipped.test.ts')
  assert.deepEqual([skipped.code, skipped.last], [2, 'fail: 0 failed, 0 passed, 1 skipped'])
  // A line with no code.
  assert.deepEqual([p.ubq('covers', 'skipped.test.ts:99').code, p.ubq('covers', 'skipped.test.ts:99').err], [
    4,
    'ubq: skipped.test.ts:99 has no code\n',
  ])
  // A line of space, and a last line with no line end.
  writeFileSync(join(p.dir, 'spaced.test.ts'), "import { test } from 'ubqtest'\n  \ntest('s', () => {})")
  p.ubq('spaced.test.ts')
  assert.equal(p.ubq('covers', 'spaced.test.ts:2').err, 'ubq: spaced.test.ts:2 has no code\n')
  assert.equal(p.ubq('covers', 'spaced.test.ts:3').out, 'spaced.test.ts > s\nspaced.test.ts (while the file loads)\n1 tests run spaced.test.ts:3\n')
})
