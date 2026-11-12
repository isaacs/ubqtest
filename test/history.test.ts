// Results from more than one run: history, diff, --repeat, and --baseline.
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assert, test } from 'ubqtest'
import { project } from './setup.ts'

/** Output lines, with the time of each run removed. */
const lines = (out: string): string[] =>
  out.trimEnd().split('\n').map(l => l.replace(/\d{4}-\d\d-\d\d \d\d:\d\d:\d\d/, 'TIME').replace(/ +\d+\.\d ms/, ' N ms'))

test('history shows the result of a test in each run, and says if the test is flaky', () => {
  const p = project()
  const a = 'flip.ts > group > a'
  p.set('pass')
  p.ubq('flip.ts', 'pass.ts')
  p.ubq('pass.ts')
  let r = p.ubq('history', a)
  assert.deepEqual([r.code, r.err], [0, ''])
  assert.deepEqual(lines(r.out), ['run 1  TIME  pass N ms', '0 failed, 1 passed in 1 runs (times are UTC)'])

  // The code changes, and then the test fails: not flaky.
  appendFileSync(join(p.dir, 'flip.ts'), '\n// a change\n')
  p.set('fail')
  p.ubq('flip.ts')
  assert.deepEqual(lines(p.ubq('history', a).out), [
    'run 1  TIME  pass N ms',
    'run 3  TIME  fail N ms  expected values to be equal',
    '1 failed, 1 passed in 2 runs (times are UTC)',
  ])

  // The same code passes: flaky.
  p.set('pass')
  p.ubq(a)
  assert.deepEqual(lines(p.ubq('history', a).out).slice(-2), [
    '1 failed, 2 passed in 3 runs (times are UTC)',
    'flaky: the test passed in run 4 and failed in run 3, and the code that it loaded was the same in the two runs',
  ])
  // A test that did not change its result is not flaky.
  assert.equal(lines(p.ubq('history', 'flip.ts > c').out).at(-1), '0 failed, 2 passed in 2 runs (times are UTC)')

  assert.deepEqual([p.ubq('history').code, p.ubq('history', 'flip.ts > nope').err], [4, 'ubq: no stored result for test: flip.ts > nope\n'])
  assert.equal(
    p.ubq('history', 'flip.ts > group').err,
    'ubq: flip.ts > group is not a test. It contains these tests:\n  flip.ts > group > a\n  flip.ts > group > b\n',
  )
  rmSync(p.dir, { recursive: true })
})

test('diff shows the tests with a different status in two runs', () => {
  const p = project()
  p.set('pass')
  p.ubq('flip.ts', 'pass.ts')
  assert.deepEqual([p.ubq('diff').code, p.ubq('diff').err], [4, 'ubq: ubq diff needs two runs, and the store has runs 1 to 1\n'])
  p.set('fail')
  p.ubq('flip.ts')

  // No run numbers: the last run and the run before it.
  const r = p.ubq('diff')
  assert.deepEqual([r.code, r.err], [1, ''])
  assert.deepEqual(lines(r.out), [
    'fail flip.ts > group > a (was pass in run 1)',
    '  expected values to be equal',
    'run 1 to run 2: 1 new failures, 0 fixed, 2 the same, 6 only in run 1',
    'details: ubq failures 2',
  ])
  const back = p.ubq('diff', '2', '1')
  assert.deepEqual([back.code, lines(back.out)], [0, [
    'pass flip.ts > group > a (was fail in run 2)',
    'run 2 to run 1: 0 new failures, 1 fixed, 2 the same, 6 only in run 1',
  ]])

  // A failure of a test that did not run in the first run, and a file error.
  p.ubq('pass.ts')
  appendFileSync(join(p.dir, 'pass.ts'), '\nthrow new Error("at load")\n')
  p.ubq('flip.ts', 'pass.ts')
  const one = p.ubq('diff', '3')
  assert.deepEqual([one.code, lines(one.out)], [1, [
    'ERROR pass.ts (no error in run 3)',
    'fail flip.ts > group > a (did not run in run 3)',
    '  expected values to be equal',
    'run 3 to run 4: 1 new failures, 0 fixed, 1 new file errors, 6 the same, 3 only in run 4',
    'details: ubq failures 4',
  ]])
  assert.deepEqual(lines(p.ubq('diff', '4', '3').out), [
    'no error pass.ts (was ERROR in run 4)',
    'run 4 to run 3: 0 new failures, 0 fixed, 6 the same, 3 only in run 4',
  ])

  const err = (...args: string[]) => [p.ubq('diff', ...args).code, p.ubq('diff', ...args).err]
  assert.deepEqual(err('9'), [4, 'ubq: run 9 is not in the store: the store has runs 1 to 4\n'])
  assert.deepEqual(err('x'), [4, 'ubq: ubq diff needs run numbers, not: x\n'])
  assert.deepEqual(err('2', '2'), [4, 'ubq: ubq diff needs two different runs, not run 2 two times\n'])
  assert.deepEqual(err('1', '2', '3'), [4, 'ubq: ubq diff takes two run numbers at most\n'])
  rmSync(p.dir, { recursive: true })
})

test('--repeat runs the tests many times and counts the failures of each test', () => {
  const p = project()
  p.set('pass')
  const flaky = 'sometimes.ts > fails each third time'
  const r = p.ubq('--repeat', '7', 'sometimes.ts', 'flip.ts')
  assert.deepEqual([r.code, r.err], [1, ''])
  assert.deepEqual(lines(r.out.replace(/ \(run \d+\)\n$/, '')), [
    `FAIL ${flaky}`,
    '  failed 2 of 7 times. The first failure:',
    '  expected values to differ, both are 0',
    '  at sometimes.ts:12:10',
    '  > assert.notEqual(n % 3, 0)',
    '  output:',
    '  | time 3',
    '  rerun: ubq sometimes.ts:10',
    '',
    'FAIL sometimes.ts > fails',
    '  failed 7 of 7 times.',
    '  expected values to be equal',
    '  at sometimes.ts:20:10',
    '  > assert.equal(1 as number, 2)',
    '  actual:   1',
    '  expected: 2',
    '  rerun: ubq sometimes.ts:19',
    '',
    'repeat 7: 1 failed some times, 1 failed each time, 4 failed no times',
    'fail: 2 failed, 4 passed',
  ])

  // The store has one run, with the first failure of each test.
  assert.deepEqual(lines(p.ubq('history', flaky).out), [
    'run 1  TIME  fail N ms  failed 2 of 7 times: expected values to differ, both are 0',
    '1 failed, 0 passed in 1 runs (times are UTC)',
    'flaky: the test failed 2 of 7 times in run 1',
  ])
  assert.deepEqual(lines(p.ubq('show', flaky).out).slice(0, 3), [
    `fail ${flaky}`,
    '  run 1, 1 assertions, N ms',
    '  failed 2 of 7 times',
  ])
  assert.equal(p.ubq('failures').last, 'fail: 2 failed, 4 passed')

  // The slowest tests of a run. A skipped test is not in the list.
  p.ubq('pass.ts', 'flip.ts')
  const slow = p.ubq('slow').out.trimEnd().split('\n')
  assert.equal(slow.length, 9)
  assert.match(slow[0]!, /^ +\d+\.\d ms  (pass|flip)\.ts > /)
  const times = slow.slice(0, -1).map(l => parseFloat(l))
  assert.deepEqual(times, times.toSorted((a, b) => b - a))
  assert.match(slow.at(-1)!, /^the 8 slowest of 8 tests took \d+\.\d ms of \d+\.\d ms \(run 2\)$/)
  assert.match(p.ubq('slow', '1').last!, /^the 6 slowest of 6 tests took /)
  assert.deepEqual([p.ubq('slow', '9').code, p.ubq('slow', '9').err], [4, 'ubq: run 9 is not in the store\n'])

  // With a selection. One file runs in its own processes too.
  const one = p.ubq('--repeat', '3', 'flip.ts > c')
  assert.deepEqual([one.code, lines(one.out.replace(/ \(run \d+\)\n$/, ''))], [0, [
    'repeat 3: 0 failed some times, 0 failed each time, 1 failed no times',
    'pass: 0 failed, 1 passed, 2 not selected',
  ]])
  assert.match(p.ubq('--failed', '--repeat', '2').out, /\nrepeat 2: \d failed some times, 1 failed each time, 0 failed no times\n/)

  // A file error.
  appendFileSync(join(p.dir, 'flip.ts'), '\nthrow new Error("at load")\n')
  assert.match(p.ubq('--repeat', '2', 'flip.ts').out, /^ERROR flip\.ts\n  failed 2 of 2 times\.\n  Error: at load\n/)

  const usage = "ubq: --repeat needs a count of 2 or more, such as: ubq --repeat 20 '<test id>'\n"
  assert.deepEqual([p.ubq('--repeat').err, p.ubq('--repeat', '1', 'flip.ts').err, p.ubq('--repeat', 'flip.ts').code], [usage, usage, 4])
  rmSync(p.dir, { recursive: true })
})

test('--baseline shows only the failures that the commit does not have', () => {
  const p = project()
  p.set('pass')
  const git = (...args: string[]) => {
    const r = spawnSync('git', ['-c', 'user.name=ubq', '-c', 'user.email=ubq@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd: p.dir, encoding: 'utf8' })
    assert.equal(r.status, 0, r.stderr)
  }
  const file = (tests: string[]) =>
    writeFileSync(join(p.dir, 'two.test.ts'), [
      "import { assert, test } from 'ubqtest'",
      "import { parse } from './src/shape.ts'",
      ...tests,
    ].join('\n') + '\n')
  const square = "test('square', () => { assert.equal(parse('s')?.kind, 'square') })"
  file([
    "test('old failure', () => { assert.equal(1, 2) })",
    square,
    "test('was broken', () => { assert.equal(1, 2) })",
    "test('removed', () => { assert.equal(1, 1) })",
  ])
  assert.deepEqual([p.ubq('--baseline', 'HEAD').code, p.ubq('--baseline', 'HEAD').err], [
    4,
    'ubq: --baseline needs a git repository, and this project is not in one\n',
  ])
  writeFileSync(join(p.dir, '.gitignore'), 'node_modules\nflip.txt*\n')
  git('init', '-q')
  git('add', '-A')
  git('commit', '-q', '-m', 'base')

  // No change: each failure is in the baseline too.
  const same = p.ubq('--baseline', 'HEAD', 'two.test.ts')
  assert.deepEqual([same.code, same.err, lines(same.out)], [1, '', [
    'baseline HEAD (COMMIT): 0 new failures, 2 failed in the baseline too, 0 fixed',
    "failed in the baseline too (not shown above; for one of them: ubq show '<test id>'):",
    '  two.test.ts > old failure',
    '  two.test.ts > was broken',
    'fail: 2 failed, 2 passed (run 1)',
  ].map(l => l.replace('COMMIT', /\((\w+)\)/.exec(same.out)![1]!))])

  // A change to a source file and to the test file.
  writeFileSync(join(p.dir, 'src/shape.ts'), "export const parse = (s: string) => ({ kind: 'circle' + s })\n")
  file([
    "test('old failure', () => { assert.equal(1, 2) })",
    square,
    "test('was broken', () => { assert.equal(2, 2) })",
    "test('new', () => { assert.equal(1, 3) })",
  ])
  const r = p.ubq('--baseline', 'HEAD', 'two.test.ts')
  assert.equal(r.code, 1)
  const out = lines(r.out)
  assert.deepEqual(out.filter(l => l.startsWith('FAIL')), ['FAIL two.test.ts > square', 'FAIL two.test.ts > new'])
  assert.deepEqual(out.slice(-6).map(l => l.replace(/\(\w{7}\)/, '(COMMIT)')), [
    'baseline HEAD (COMMIT): 2 new failures, 1 failed in the baseline too, 1 fixed, 1 tests of the baseline did not run',
    "failed in the baseline too (not shown above; for one of them: ubq show '<test id>'):",
    '  two.test.ts > old failure',
    'fixed:',
    '  two.test.ts > was broken',
    'fail: 3 failed, 1 passed (run 2)',
  ])
  // The store has all the failures of the run.
  assert.equal(p.ubq('failures').last, 'fail: 3 failed, 1 passed')
  // The checkout is gone, and git has no record of it.
  assert.deepEqual(readdirSync(join(p.dir, '.ubq/baseline')), [])
  assert.equal(spawnSync('git', ['worktree', 'list'], { cwd: p.dir, encoding: 'utf8' }).stdout.trim().split('\n').length, 1)
  assert.equal(existsSync(join(p.dir, '.git/worktrees')), false)

  // All test files, and a test file that the commit does not have.
  writeFileSync(join(p.dir, 'new.test.ts'), "import { assert, test } from 'ubqtest'\ntest('bad', () => { assert.equal(1, 2) })\n")
  assert.match(p.ubq('--baseline', 'HEAD').out, /\nbaseline HEAD \(\w+\): 3 new failures, 1 failed in the baseline too, 1 fixed, 1 tests of the baseline did not run\n/)
  assert.match(p.ubq('--baseline', 'HEAD', 'new.test.ts').out, /\nbaseline HEAD \(\w+\): 1 new failures, 0 failed in the baseline too, 0 fixed\n/)

  const err = (...args: string[]) => [p.ubq(...args).code, p.ubq(...args).err]
  assert.deepEqual(err('--baseline', 'nope'), [4, 'ubq: --baseline needs a git commit, and git does not know: nope. Examples: ubq --baseline HEAD, ubq --baseline main\n'])
  assert.deepEqual(err('--baseline'), [4, 'ubq: --baseline needs a git commit, such as: ubq --baseline HEAD\n'])
  assert.deepEqual(err('--baseline', 'HEAD', '--failed'), [4, 'ubq: --baseline takes files and test IDs, and no other option\n'])
  assert.deepEqual(err('--baseline', 'HEAD', '--repeat', '2'), [4, 'ubq: --baseline takes files and test IDs, and no other option\n'])
  rmSync(p.dir, { recursive: true })
})
