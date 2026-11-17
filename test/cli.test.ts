// The command line: help, and the message for each wrong command.
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  // A command with --help prints the help, and does not run.
  for (const flag of [['help'], ['--help'], ['-h'], ['doctor', '--help'], ['run', 'a.test.ts', '-h']]) {
    const r = p.ubq(...flag)
    assert.deepEqual([r.code, r.out.split('\n')[0], r.out.includes('\n  ubq uncovered [file]')], [0, 'usage:', true])
  }
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string
  }
  assert.deepEqual([p.ubq('--version').code, p.ubq('--version').out], [0, `${version}\n`])
  // The help names each agent that `ubq skill <agent>` knows.
  assert.match(p.ubq('help').out, /named agent \(claude, cursor, gemini, copilot, codex, antigravity, agents\)\n/)
  // A command that reads the store, with no store.
  assert.deepEqual(error('failures'), [4, 'ubq: no run. Run: ubq'])
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
    '  test at many.test.ts:5',
    '  skip reason: not now',
  ])
  assert.match(p.ubq('history', 'many.test.ts > later').out, /\n0 failed, 0 passed, 2 skipped in 2 runs\n$/)
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
    'run 4 to run 5: 1 new failures, 1 other changes, 1 only in run 5',
    'details: ubq failures 5',
  ])
  // A failure: the place of the test, the place of the failure, and
  // the command that runs it again.
  const shown = p.ubq('show', 'many.test.ts > broken').out.split('\n')
  assert.deepEqual(
    shown.filter(l => /^ {2}(test at |at |rerun: )/.test(l)),
    ['  test at many.test.ts:3', '  at many.test.ts:3:29', '  rerun: ubq many.test.ts:3'],
  )
  // A test of a file that did not load: the message names the error
  // of the file.
  writeFileSync(join(p.dir, 'bad.test.ts'), "import { test } from 'ubqtest'\ntest('t', () => {})\nconst = 1\n")
  p.ubq('bad.test.ts')
  const bad = error('show', 'bad.test.ts > t')
  assert.equal(bad[0], 4)
  assert.match(
    bad[1],
    /^ubq: no stored result for test: bad\.test\.ts > t\n  bad\.test\.ts had an error in run 6: the test file did not load: .+\n  at bad\.test\.ts:3:\d+$/,
  )
  assert.match(
    error('skill', 'nope')[1],
    /^ubq: unknown agent "nope"\. The agents are: claude, .* A folder also works: ubq skill \.myagent\/skills$/,
  )
})

test('a file that ends the process, cut output, and a run of only skipped tests', { timeout: 60_000 }, () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true, force: true }))
  // No import of ubqtest: the runner must report the exit.
  writeFileSync(join(p.dir, 'exits.test.ts'), 'process.exit(3)\n')
  const exits = p.ubq('exits.test.ts')
  assert.deepEqual(
    [exits.code, exits.out.split('\n').slice(0, 2)],
    [
      1,
      [
        'ERROR exits.test.ts',
        "  the test process ended before the file loaded ubqtest (exit code 3). A test file must import 'ubqtest'.",
      ],
    ],
  )
  // An error with no place.
  assert.equal(
    p.ubq('show', 'exits.test.ts > t').err,
    "ubq: no stored result for test: exits.test.ts > t\n  exits.test.ts had an error in run 1: the test process ended before the file loaded ubqtest (exit code 3). A test file must import 'ubqtest'.\n",
  )
  // No import of ubqtest, and no exit: the runner reports it too.
  writeFileSync(join(p.dir, 'exits.test.ts'), 'void 0\n')
  const plain = p.ubq('exits.test.ts')
  assert.deepEqual(
    [plain.code, plain.out.split('\n').slice(0, 2)],
    [
      1,
      [
        'ERROR exits.test.ts',
        "  the test process ended before the file loaded ubqtest (exit code 0). A test file must import 'ubqtest'.",
      ],
    ],
  )
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
  const ci = spawnSync('node', [cli, 'noisy.test.ts'], {
    cwd: p.dir,
    encoding: 'utf8',
    env: { ...process.env, CI: '1' },
  })
  assert.match(ci.stdout, /\n  output:\n  \| line 1\n/)
  assert.equal(ci.stdout.match(/^  \| line /gm)?.length, 30)
  writeFileSync(join(p.dir, 'skipped.test.ts'), "import { test } from 'ubqtest'\ntest('s', { skip: 'x' }, () => {})\n")
  const skipped = p.ubq('skipped.test.ts')
  assert.deepEqual([skipped.code, skipped.last], [2, 'fail: 0 failed, 0 passed, 1 skipped'])
  // A line with no code.
  assert.deepEqual(
    [p.ubq('covers', 'skipped.test.ts:99').code, p.ubq('covers', 'skipped.test.ts:99').err],
    [4, 'ubq: skipped.test.ts:99 has no code\n'],
  )
  // A line of space, and a last line with no line end.
  writeFileSync(join(p.dir, 'spaced.test.ts'), "import { test } from 'ubqtest'\n  \ntest('s', () => {})")
  p.ubq('spaced.test.ts')
  assert.equal(p.ubq('covers', 'spaced.test.ts:2').err, 'ubq: spaced.test.ts:2 has no code\n')
  assert.equal(p.ubq('covers', 'spaced.test.ts:3').out, 'spaced.test.ts > s\nspaced.test.ts (while the file loads)\n')
})

test('a reader that closes the pipe early', async () => {
  const child = spawn('node', [cli, 'help'], { stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.destroy()
  let err = ''
  child.stderr.on('data', (data: Buffer) => (err += data))
  const code = await new Promise(done => child.on('close', done))
  assert.deepEqual([code, err], [0, ''])
})

test('ubq run takes paths only, and a path with the name of a command gets a note', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true, force: true }))
  mkdirSync(join(p.dir, 'diff'))
  writeFileSync(
    join(p.dir, 'diff/a.test.ts'),
    "import { assert, test } from 'ubqtest'\ntest('p', () => assert(true))\n",
  )
  // `ubq run <folder>` runs the folder, also with the name of a command.
  const run = p.ubq('run', 'diff')
  assert.deepEqual([run.code, run.last, run.err], [0, 'pass: 0 failed, 1 passed', ''])
  // `ubq run` with no path runs all test files.
  const all = p.ubq('run')
  assert.deepEqual([all.code, all.last], [0, 'pass: 0 failed, 1 passed'])
  // The command wins, and a note tells how to run the folder.
  const command = p.ubq('diff')
  assert.equal(command.err, 'note: "diff" is a ubq command. To run the tests in ./diff: ubq run diff\n')
  assert(!command.out.includes('pass:'))
  // No note if the project has no such file or folder.
  assert.equal(p.ubq('slow').err, '')
})
