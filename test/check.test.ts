// `ubq check`: the last result of each test is a pass, and is the
// result of the code as it is now, and each changed line ran in a
// test. And `ubq check --hook`, the stop hook of a coding agent.
import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { assert, cleanup, test } from 'ubqtest'
import { project, remove } from './setup.ts'

const SRC = 'export const add = (a: number, b: number): number => a + b\n'
const TEST = `import { assert, test } from 'ubqtest'
import { add } from '../src/math.ts'
test('add', () => assert.equal(add(1, 2), 3))
`
const PASS = 'pass: 1 test passes on the code as it is now'

/** A project with one source file and one test file, in git if `git` is true. */
const setup = (git = true) => {
  const p = project()
  cleanup(() => remove(p.dir))
  mkdirSync(join(p.dir, 'lib'))
  mkdirSync(join(p.dir, 'test'))
  writeFileSync(join(p.dir, 'lib/math.ts'), SRC)
  writeFileSync(join(p.dir, 'test/math.test.ts'), TEST.replace('../src/', '../lib/'))
  const run = (...args: string[]) => {
    const r = spawnSync(
      'git',
      ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args],
      { cwd: p.dir, encoding: 'utf8' },
    )
    assert.equal(r.status, 0, r.stderr)
  }
  if (git) {
    writeFileSync(join(p.dir, '.gitignore'), 'node_modules\n.ubq\n')
    run('init', '-q')
    run('add', '.')
    run('commit', '-q', '-m', 'first')
  }
  return { ...p, git: run, file: (name: string) => join(p.dir, name) }
}

test('ubq check: no run, a pass, code that changed, and a run of the changed tests', () => {
  const p = setup()
  let r = p.ubq('check')
  assert.equal(r.code, 1)
  assert.equal(r.out, 'fail: no run. Run: ubq\n')

  assert.equal(p.ubq().code, 0)
  r = p.ubq('check')
  assert.equal(r.code, 0)
  assert.equal(r.last, `${PASS}, and each change ran in a test.`)

  // The test ran the code that changed: its result is old.
  writeFileSync(p.file('lib/math.ts'), SRC.replace('a + b', 'b + a'))
  r = p.ubq('check')
  assert.equal(r.code, 1)
  assert.match(r.out, /^1 test file to run again: test\/math\.test\.ts\. Run: ubq --changed$/m)
  assert.equal(r.last, 'fail: 1 test file to run again')

  assert.equal(p.ubq('--changed').code, 0)
  assert.equal(p.ubq('check').code, 0)
})

test('ubq check: failed tests, file errors, and new test files', () => {
  const p = setup()
  // 11 failures: the report names 10.
  writeFileSync(
    p.file('test/bad.test.ts'),
    "import { assert, test } from 'ubqtest'\n" +
      Array.from(
        { length: 11 },
        (_, i) => `test('wrong ${String(i).padStart(2, '0')}', () => assert.equal(1, 2))\n`,
      ).join(''),
  )
  writeFileSync(p.file('test/broken.test.ts'), "import { test } from 'ubqtest'\nthrow new Error('boom')\n")
  assert.equal(p.ubq().code, 1)
  let r = p.ubq('check')
  assert.equal(r.code, 1)
  assert.match(
    r.out,
    /^11 failed tests: test\/bad\.test\.ts > wrong 00, .*, test\/bad\.test\.ts > wrong 09, and 1 more\. To see them: ubq failures$/m,
  )
  assert.match(r.out, /^1 file errors: test\/broken\.test\.ts$/m)
  assert.match(r.out, /^After a fix, run: ubq --failed$/m)
  assert.equal(r.last, 'fail: 11 failed tests, 1 file errors')

  // A file that the configuration now leaves out has no result to
  // correct: not for the check, and not for --failed.
  p.configure({ exclude: ['test/broken.*'] })
  assert.equal(p.ubq('check').last, 'fail: 11 failed tests')
  p.configure({ exclude: ['test/b*'] })
  assert.equal(p.ubq('--failed').code, 2)
  p.configure()

  rmSync(p.file('test/bad.test.ts'))
  rmSync(p.file('test/broken.test.ts'))
  // A test file that never ran.
  writeFileSync(p.file('test/more.test.ts'), TEST.replace('../src/', '../lib/'))
  r = p.ubq('check')
  assert.equal(r.code, 1)
  assert.equal(r.last, 'fail: 1 test file to run again')
  assert.equal(p.ubq('--changed').code, 0)
  assert.equal(p.ubq('check').code, 0)
})

test('ubq check: a failure stays after a run of a different test of its file', () => {
  const p = setup()
  writeFileSync(
    p.file('test/two.test.ts'),
    "import { assert, test } from 'ubqtest'\ntest('a', () => assert.equal(1, 2))\ntest('b', () => assert.equal(1, 1))\n",
  )
  assert.equal(p.ubq().code, 1)
  assert.equal(p.ubq('test/two.test.ts:3').code, 0)
  let r = p.ubq('check')
  assert.equal(r.last, 'fail: 1 failed tests')
  // ubq --failed runs the failed test, and not the others.
  assert.match(p.ubq('--failed').out, /^fail: 1 failed, 0 passed, 1 not selected \(run 3: ubq failures 3\)$/m)
  // A test that a run of all of its file did not have is gone.
  writeFileSync(
    p.file('test/two.test.ts'),
    "import { assert, test } from 'ubqtest'\ntest('b', () => assert.equal(1, 1))\n",
  )
  assert.equal(p.ubq('test/two.test.ts').code, 0)
  r = p.ubq('check')
  assert.equal(r.code, 0)
})

test('ubq check: a pass counts each test, and lists the changes to the tests to look at', () => {
  const p = setup()
  writeFileSync(
    p.file('test/math.test.ts'),
    TEST.replace('../src/', '../lib/') + "test('zero', () => assert.equal(add(0, 0), 0))\n",
  )
  p.git('commit', '-qam', 'zero')
  assert.equal(p.ubq().code, 0)
  // A run of one test: the count has the last result of each test.
  assert.equal(p.ubq('test/math.test.ts:3').code, 0)
  assert.equal(p.ubq('check').out, 'pass: 2 tests pass on the code as it is now, and each change ran in a test.\n')

  writeFileSync(p.file('test/math.test.ts'), TEST.replace('../src/', '../lib/').replace('add(1, 2)', 'add(2, 1)'))
  assert.equal(p.ubq().code, 0)
  const r = p.ubq('check')
  assert.equal(r.code, 0)
  assert.equal(
    r.out.replace(/\b[0-9a-f]{7}\b/, 'HASH'),
    [
      'Changes to the tests to look at:',
      'removed: test/math.test.ts > zero (test/math.test.ts:4 in HASH)',
      'assertions changed: test/math.test.ts > add (test/math.test.ts:3)',
      '  - assert.equal(add(1, 2), 3)',
      '  + assert.equal(add(2, 1), 3)',
      'pass: 1 test passes on the code as it is now, and each change ran in a test.',
      '',
    ].join('\n'),
  )
})

test('ubq check: changed lines that no test runs, and changed files that no test loads', () => {
  const p = setup()
  assert.equal(p.ubq().code, 0)
  appendFileSync(p.file('lib/math.ts'), 'export const mul = (a: number, b: number): number => a * b\n')
  writeFileSync(p.file('lib/other.ts'), 'export const one = 1\n')
  p.ubq('--changed')
  let r = p.ubq('check')
  assert.equal(r.code, 1)
  assert.equal(
    r.out,
    [
      '1 uncovered range in changed lines:',
      '  lib/math.ts:2:20  (a: number, b: number): number => a * b',
      'Write a test that runs them. All of them: ubq uncovered --diff. For code that no test can reach, a comment: // ubq: not measured: <reason>',
      '1 changed file that no test loads: lib/other.ts',
      'Write a test that loads each one. For a file that no test can load, a comment before its first code: // ubq: not measured: <reason>',
      'fail: 1 uncovered range in changed lines, 1 changed file that no test loads',
      '',
    ].join('\n'),
  )

  // After a commit, the lines are the same as the commit. --diff
  // names a commit before it.
  p.git('add', '.')
  p.git('commit', '-q', '-m', 'second')
  assert.equal(p.ubq('check').code, 0)
  r = p.ubq('check', '--diff=HEAD~1')
  assert.equal(r.code, 1)
  assert.match(r.out, /uncovered range in changed lines:\n.*\n.*ubq uncovered --diff=HEAD~1\./)

  // A comment marks code that no test can reach.
  writeFileSync(
    p.file('lib/math.ts'),
    SRC + '// ubq: not measured: no test can reach it\nexport const mul = (a: number, b: number): number => a * b\n',
  )
  // A test file that is not in a test folder: a function in it
  // that no test calls is not uncovered code of the program.
  writeFileSync(
    p.file('lib/math.spec.ts'),
    "import { assert, test } from 'ubqtest'\nconst unused = (): number => 1\ntest('spec', () => assert.equal(typeof unused, 'function'))\n",
  )
  p.configure({ include: ['test/**/*.test.ts', 'lib/**/*.spec.ts'] })
  p.ubq()
  assert(!p.ubq('check', '--diff=HEAD~1').out.includes('math.spec.ts'))
  rmSync(p.file('lib/math.spec.ts'))
  p.configure()
  // A comment before the first code of a file: no test can load
  // the file. A comment after code is for a range only.
  p.ubq('--changed')
  assert.match(p.ubq('check', '--diff=HEAD~1').out, /^1 changed file that no test loads: lib\/other\.ts$/m)
  writeFileSync(p.file('lib/other.ts'), 'export const one = 1\n// ubq: not measured: the entry of a worker\n')
  assert.match(p.ubq('check', '--diff=HEAD~1').out, /^1 changed file that no test loads: lib\/other\.ts$/m)
  writeFileSync(
    p.file('lib/other.ts'),
    '#!/usr/bin/env node\n/* The worker. */\n\n// ubq: not measured: the entry of a worker\nexport const one = 1\n',
  )
  assert.equal(p.ubq('check', '--diff=HEAD~1').code, 0)
})

test('ubq check: the lines are checked only when the results are current', () => {
  const p = setup()
  assert.equal(p.ubq().code, 0)
  // An uncovered function, and a change that the test ran.
  writeFileSync(
    p.file('lib/math.ts'),
    SRC.replace('a + b', 'b + a') + 'export const mul = (a: number, b: number): number => a * b\n',
  )
  const r = p.ubq('check')
  assert.equal(r.last, 'fail: 1 test file to run again')
  assert(!r.out.includes('ran in no test'))
})

test('ubq check: with no git, it does not check lines', () => {
  const p = setup(false)
  assert.equal(p.ubq().code, 0)
  appendFileSync(p.file('lib/math.ts'), 'export const mul = (a: number, b: number): number => a * b\n')
  p.ubq('--changed')
  const r = p.ubq('check')
  assert.equal(r.code, 0)
  assert.equal(r.last, `${PASS}.`)
})

test('ubq check: a wrong argument', () => {
  const p = setup(false)
  const r = p.ubq('check', 'now')
  assert.equal(r.code, 4)
  assert.equal(r.err, 'ubq: ubq check takes --diff=<commit> and --hook, not: now\n')
})

test('ubq check --hook blocks the stop of an agent one time for each report', () => {
  const p = setup()
  const hook = () => {
    const r = p.ubq('check', '--hook')
    assert.equal(r.code, 0)
    return r.out ? (JSON.parse(r.out) as { decision: string; reason: string }) : undefined
  }
  // No run.
  let d = hook()
  assert.equal(d?.decision, 'block')
  assert.match(d!.reason, /^ubq check: the tests do not show that the work is done\.\nfail: no run\. Run: ubq\n/)
  assert.match(d!.reason, /\nDo the steps above, then stop\. If you cannot do a step, tell the user why\.$/)
  // The agent stops again with the same report: it saw it.
  assert.equal(hook(), undefined)

  assert.equal(p.ubq().code, 0)
  assert.equal(hook(), undefined)
  // A new problem blocks again.
  writeFileSync(p.file('lib/math.ts'), SRC.replace('a + b', 'b + a'))
  d = hook()
  assert.match(d!.reason, /Run: ubq --changed/)
  assert.equal(hook(), undefined)
  p.ubq('--changed')
  assert.equal(hook(), undefined)
  // The same problem after a pass is a new report.
  writeFileSync(p.file('lib/math.ts'), SRC)
  assert.equal(hook()?.decision, 'block')
})

test('ubq check: more than 10 ranges, and a range of more than one line', () => {
  const p = setup()
  assert.equal(p.ubq().code, 0)
  const fns = Array.from({ length: 10 }, (_, i) => `export const f${i} = () => ${i}\n`).join('')
  writeFileSync(p.file('lib/more.ts'), 'export const g = () => {\n  return 1\n}\n' + fns)
  writeFileSync(
    p.file('test/more.test.ts'),
    "import { assert, test } from 'ubqtest'\nimport '../lib/more.ts'\ntest('t', () => assert(1))\n",
  )
  assert.equal(p.ubq().code, 0)
  const r = p.ubq('check')
  assert.equal(r.code, 1)
  const lines = r.out.split('\n')
  assert.equal(lines[0], '11 uncovered ranges in changed lines:')
  assert.equal(lines[1], '  lib/more.ts:1:18  () => { (+2 lines)')
  assert.equal(lines[2], '  lib/more.ts:4:19  () => 0')
  assert.equal(lines[11], '  and 1 more')
})

test('ubq check: a run in progress, a store with no run, and type errors', () => {
  const p = setup()
  assert.equal(p.ubq().code, 0)
  mkdirSync(p.file('.ubq/now'), { recursive: true })
  // The process of a run that was stopped is gone.
  const gone = spawnSync(process.execPath, ['-e', '0']).pid
  writeFileSync(p.file('.ubq/now/8.json'), JSON.stringify({ run: 8, pid: gone, running: {} }))
  assert.equal(p.ubq('check').code, 0)
  rmSync(p.file('.ubq/now/8.json'))
  // This process is alive: its run is in progress.
  writeFileSync(p.file('.ubq/now/9.json'), JSON.stringify({ run: 9, pid: process.pid, running: {} }))
  let r = p.ubq('check')
  assert.equal(r.code, 1)
  assert.equal(r.out, 'fail: run 9 is in progress. Wait for its end, then run: ubq check. To see it: ubq status\n')
  rmSync(p.file('.ubq/now/9.json'))

  const db = new DatabaseSync(p.file('.ubq/runs.db'))
  db.exec('delete from run')
  db.close()
  r = p.ubq('check')
  assert.equal(r.out, 'fail: no run. Run: ubq\n')

  writeFileSync(p.file('lib/math.ts'), SRC + "export const n: number = 'one'\n")
  writeFileSync(
    p.file('tsconfig.json'),
    JSON.stringify({
      compilerOptions: { module: 'nodenext', strict: true, noEmit: true, allowImportingTsExtensions: true },
      include: ['lib'],
    }),
  )
  const modules = fileURLToPath(new URL('../node_modules/', import.meta.url))
  symlinkSync(join(modules, 'typescript'), p.file('node_modules/typescript'), 'junction')
  assert.equal(p.ubq().code, 1)
  r = p.ubq('check')
  assert.match(r.out, /^1 type error\. To see them: ubq failures \d+$/m)
  assert.equal(r.last, 'fail: 1 type error')
})

test('ubq check: a test file with no coverage runs again only if it changed', () => {
  const p = setup()
  assert.equal(p.ubq().code, 0)
  const db = new DatabaseSync(p.file('.ubq/runs.db'))
  db.exec("update test_file set coverage = 'none'")
  db.close()
  assert.equal(p.ubq('check').code, 0)
  appendFileSync(p.file('test/math.test.ts'), '// more\n')
  assert.equal(p.ubq('check').last, 'fail: 1 test file to run again')
})
