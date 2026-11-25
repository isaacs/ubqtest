// Selection of tests: by ID, and by the result of the last run.
import { spawnSync } from 'node:child_process'
import { appendFileSync, cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assert, cleanup, test } from 'ubqtest'
import { cli, project } from './setup.ts'

test('a test ID selects one test, and a group ID selects its tests', () => {
  const p = project()
  p.set('pass')
  const one = p.ubq('flip.ts > c')
  assert.deepEqual([one.code, one.last, one.err], [0, 'pass: 1 test, 2 not selected', ''])
  assert.equal(p.ubq('flip.ts > group').last, 'pass: 2 tests, 1 not selected')
  assert.equal(p.ubq('flip.ts > group > b', 'flip.ts > c').last, 'pass: 2 tests, 1 not selected')
  assert.equal(p.ubq('flip.ts > c', 'pass.ts').last, 'pass: 6 tests, 1 skipped, 2 not selected')
  const none = p.ubq('flip.ts > nope')
  assert.equal(none.code, 2)
  assert.match(
    none.out,
    /no test of this file has an ID in the selection\. The IDs in this file are:\n  flip\.ts > group > a\n/,
  )
  assert.deepEqual([p.ubq('gone.ts > x').code, p.ubq('gone.ts > x').err], [4, 'ubq: no such file: gone.ts\n'])
  rmSync(p.dir, { recursive: true })
})

test('--failed runs the tests that failed in their last run', () => {
  const p = project()
  p.set('fail')
  assert.equal(p.ubq('flip.ts', 'pass.ts').last, 'fail: 1 failed, 7 passed, 1 skipped')
  // Only the failed test runs. It fails again.
  assert.equal(p.ubq('--failed').last, 'fail: 1 failed, 0 passed, 2 not selected')
  p.set('pass')
  assert.equal(p.ubq('--failed').last, 'pass: 1 test, 2 not selected')
  // Now no test has a failure as its last result.
  assert.deepEqual([p.ubq('--failed').code, p.ubq('--failed').err], [2, 'ubq: no failed tests\n'])
  assert.equal(p.ubq('--failed', 'flip.ts').code, 4)
  assert.equal(p.ubq('--nope').code, 4)
  rmSync(p.dir, { recursive: true })
})

test('--changed runs the test files that loaded a changed file', () => {
  const p = project()
  p.set('pass')
  assert.equal(p.ubq('flip.ts', 'pass.ts').last, 'pass: 8 tests, 1 skipped')
  const none = p.ubq('--changed')
  assert.equal(none.code, 2)
  assert.match(none.err, /^ubq: no changes, no new tests, no failed tests$/m)

  // Only pass.ts loads src/shape.ts.
  appendFileSync(join(p.dir, 'src/shape.ts'), '\n// a change\n')
  assert.equal(
    p.ubq('--changed').out.replace(/ \(run \d+[^)]*\)/, ''),
    ['changed: src/shape.ts', 'skip pass.ts > not on this platform: needs a GPU', 'pass: 5 tests, 1 skipped', ''].join(
      '\n',
    ),
  )
  assert.equal(p.ubq('--changed').code, 2)

  // A change to a test file, and a new test file.
  appendFileSync(join(p.dir, 'flip.ts'), '\n// a change\n')
  mkdirSync(join(p.dir, 'test'))
  cpSync(join(p.dir, 'flip.ts'), join(p.dir, 'test/new.test.ts'))
  const both = p.ubq('--changed')
  assert.deepEqual(both.out.split('\n').slice(0, 2), ['changed: flip.ts', 'new: test/new.test.ts'])
  assert.equal(both.last, 'pass: 6 tests')
  assert.equal(p.ubq('--changed').code, 2)
  assert.equal(p.ubq('--changed', '--failed').code, 4)
  rmSync(p.dir, { recursive: true })
})

test('ubq does not go into a folder that has its own package.json', () => {
  const p = project()
  p.set('pass')
  mkdirSync(join(p.dir, 'test'))
  cpSync(join(p.dir, 'flip.ts'), join(p.dir, 'test/a.test.ts'))
  mkdirSync(join(p.dir, 'other/test'), { recursive: true })
  cpSync(join(p.dir, 'flip.ts'), join(p.dir, 'other/test/b.test.ts'))
  assert.equal(p.ubq().last, 'pass: 6 tests')
  writeFileSync(join(p.dir, 'other/package.json'), '{}')
  assert.equal(p.ubq().last, 'pass: 3 tests')
  const r = p.ubq('other')
  assert.deepEqual(
    [r.code, r.err],
    [
      4,
      'ubq: other is a different project: it has its own package.json. Run ubq in that folder, or name its test files.\n',
    ],
  )
  // A file that is an argument always runs.
  assert.equal(p.ubq('other/test/b.test.ts').last, 'pass: 3 tests')
  // A build of the test files in `dist` is a second copy of each
  // test. A `dist` folder that is not at the root is not known as
  // build output.
  mkdirSync(join(p.dir, 'dist/test'), { recursive: true })
  mkdirSync(join(p.dir, 'src/dist'), { recursive: true })
  writeFileSync(
    join(p.dir, 'dist/test/a.test.js'),
    "import { assert, test } from 'ubqtest'\ntest('built', () => assert(true))\n",
  )
  assert.equal(p.ubq().last, 'pass: 3 tests')
  cpSync(join(p.dir, 'flip.ts'), join(p.dir, 'src/dist/c.test.ts'))
  assert.equal(p.ubq().last, 'pass: 6 tests')
  // As an argument, and with an `include` key, the files of `dist` run.
  assert.equal(p.ubq('dist/test/a.test.js').last, 'pass: 1 test')
  p.configure({ include: ['dist/**/*.test.js'] })
  assert.equal(p.ubq().last, 'pass: 1 test')
  rmSync(p.dir, { recursive: true })
})

test('the ubq key of package.json sets include, exclude, and timeout', () => {
  const p = project()
  p.set('pass')
  mkdirSync(join(p.dir, 'test/slow'), { recursive: true })
  cpSync(join(p.dir, 'flip.ts'), join(p.dir, 'test/a.test.ts'))
  cpSync(join(p.dir, 'flip.ts'), join(p.dir, 'test/slow/b.test.ts'))
  assert.equal(p.ubq().last, 'pass: 6 tests')

  p.configure({ exclude: ['test/slow/**'] })
  assert.equal(p.ubq().last, 'pass: 3 tests')
  // A file that is an argument always runs.
  assert.equal(p.ubq('test/slow/b.test.ts').last, 'pass: 3 tests')

  // `include` replaces the name pattern.
  p.configure({ include: ['flip.ts', 'test/**'], exclude: ['test/slow/**'] })
  assert.equal(p.ubq().last, 'pass: 6 tests')
  assert.equal(p.ubq('test').last, 'pass: 3 tests')

  writeFileSync(
    join(p.dir, 'wait.ts'),
    [
      "import { assert, test } from 'ubqtest'",
      "test('waits', async () => { assert.equal(1, 1); await new Promise(r => setTimeout(r, 300)) })",
    ].join('\n'),
  )
  p.configure({ timeout: 50 })
  assert.match(p.ubq('wait.ts').out, /the test did not end in 50 ms/)
  // A cleanup function of the file has the limit of the config.
  writeFileSync(
    join(p.dir, 'wait.ts'),
    [
      "import { assert, cleanup, test } from 'ubqtest'",
      'cleanup(() => new Promise(r => setTimeout(r, 300)))',
      "test('ends', () => assert.equal(1, 1))",
    ].join('\n'),
  )
  assert.match(p.ubq('wait.ts').out, /ERROR wait\.ts\n {2}a cleanup function did not end in 50 ms\n/)
  rmSync(p.dir, { recursive: true })
})

test('a wrong ubq key in package.json is an error that names the keys', () => {
  const p = project()
  p.set('pass')
  const err = (ubq: unknown, ...args: string[]) => {
    p.configure(ubq)
    const r = p.ubq(...args)
    return [r.code, r.err]
  }
  assert.deepEqual(err({ testMatch: ['x'] }), [
    4,
    'ubq: unknown key "testMatch" in "ubq" in package.json. The keys are: include, exclude, helpers, build, timeout, hangRerun, bunInspectorCoverage, browser, workers, define, transform, env, skipTypecheck, coverage, dom\n',
  ])
  assert.deepEqual(err({ include: 'test' }), [
    4,
    'ubq: "ubq.include" in package.json must be a list of glob patterns, such as ["test/**/*.test.ts"]\n',
  ])
  assert.deepEqual(err({ timeout: '5s' }, 'flip.ts', 'pass.ts'), [
    4,
    'ubq: "ubq.timeout" in package.json must be a number of milliseconds, such as 5000\n',
  ])
  assert.match(err({ browser: 1 })[1] as string, /^ubq: "ubq\.browser" in package\.json must be an object with "url"/)
  assert.match(err({ workers: [1] })[1] as string, /^ubq: "ubq\.workers" in package\.json must be a list of objects/)
  for (const define of [[], { 'process.env.X': 1 }])
    assert.deepEqual(err({ define }), [
      4,
      'ubq: "ubq.define" in package.json must be an object of names and JSON values, such as { "__DEBUG_BUILD__": true }. Each name is a global name: a dot is not permitted\n',
    ])
  rmSync(p.dir, { recursive: true })
})

test('the workspaces run at the same time, and share the slots of one run', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  writeFileSync(join(p.dir, 'package.json'), JSON.stringify({ type: 'module', workspaces: ['packages/*'] }))
  const slots = availableParallelism() + 1
  const log = join(p.dir, 'log.txt')
  // With no shared slots, each workspace would run this many files
  // at the same time. The first file of each is long: it ends when
  // a file of the other workspace started, or after 60 s. So a slot
  // that a gives back goes to b while that file of a still runs,
  // also on a slow machine.
  for (const name of ['a', 'b']) {
    const other = name === 'a' ? '+ b ' : '+ a '
    mkdirSync(join(p.dir, 'packages', name), { recursive: true })
    writeFileSync(join(p.dir, 'packages', name, 'package.json'), JSON.stringify({ name, type: 'module' }))
    for (let i = 0; i < slots; i++)
      writeFileSync(
        join(p.dir, 'packages', name, `t${i}.test.ts`),
        `import { appendFileSync, readFileSync } from 'node:fs'
import { assert, test } from 'ubqtest'
const sleep = () => new Promise(resolve => setTimeout(resolve, 100))
test('t', { timeout: 120_000 }, async () => {
  appendFileSync(${JSON.stringify(log)}, '+ ${name} ' + Date.now() + '\\n')
  await sleep()
  for (let n = 0; ${i ? 'false' : 'n < 600'} && !readFileSync(${JSON.stringify(log)}, 'utf8').includes('${other}'); n++) await sleep()
  // The clock of Windows has steps of 15 ms: the end must have a later time than that start.
  await sleep()
  appendFileSync(${JSON.stringify(log)}, '- ${name} ' + Date.now() + '\\n')
  assert(true)
})
`,
      )
  }
  // A workspace with a type check: the checker holds a slot too.
  const c = join(p.dir, 'packages', 'c')
  mkdirSync(join(c, 'lib'), { recursive: true })
  mkdirSync(join(c, 'node_modules'))
  writeFileSync(join(c, 'package.json'), JSON.stringify({ name: 'c', type: 'module' }))
  writeFileSync(join(c, 'lib/n.ts'), 'export const n: number = 1\n')
  writeFileSync(join(c, 'one.test.ts'), "import { assert, test } from 'ubqtest'\ntest('one', () => assert(true))\n")
  writeFileSync(join(c, 'tsconfig.json'), JSON.stringify({ compilerOptions: { noEmit: true }, include: ['lib'] }))
  const modules = fileURLToPath(new URL('../node_modules/', import.meta.url))
  symlinkSync(join(modules, 'typescript'), join(c, 'node_modules/typescript'), 'junction')
  const r = p.ubq()
  assert.equal(r.last, 'workspaces: 3 passed', r.out)
  const events = readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .map(line => line.split(' '))
    .map(([sign, name, at]) => ({ sign, name, at: +at! }))
  // At the same time, an end comes before a start.
  events.sort((x, y) => x.at - y.at || (x.sign === '-' ? -1 : 1))
  let most = 0
  const running = { a: 0, b: 0 }
  let both = false
  for (const { sign, name } of events) {
    running[name as 'a' | 'b'] += sign === '+' ? 1 : -1
    most = Math.max(most, running.a + running.b)
    both ||= running.a > 0 && running.b > 0
  }
  assert.lessThanOrEqual(most, slots)
  assert(both, 'the files of a and b ran at the same time')
})

test('at the root of a monorepo with no tests, ubq runs each workspace', () => {
  const p = project()
  writeFileSync(join(p.dir, 'package.json'), JSON.stringify({ type: 'module', workspaces: ['packages/*'] }))
  for (const [name, value] of [
    ['a', 1],
    ['b', 2],
    ['empty', 0],
  ] as const) {
    mkdirSync(join(p.dir, 'packages', name), { recursive: true })
    writeFileSync(join(p.dir, 'packages', name, 'package.json'), JSON.stringify({ name, type: 'module' }))
    if (value)
      writeFileSync(
        join(p.dir, 'packages', name, 'one.test.ts'),
        `import { assert, test } from 'ubqtest'\ntest('one', () => {\n  assert.equal(${value}, 1)\n})\n`,
      )
  }
  const r = p.ubq()
  assert.equal(r.code, 1)
  assert.deepEqual(
    r.out
      .replace(/ \(run \d+[^)]*\)/g, '')
      .split('\n')
      .filter(l => /^(workspace|pass|fail|FAIL)/.test(l)),
    [
      'workspace packages/a:',
      'pass: 1 test',
      'workspace packages/b:',
      'FAIL one.test.ts > one',
      'fail: 1 failed, 0 passed',
      'workspace packages/empty:',
      'workspaces: 1 of 2 failed: packages/b. Run ubq in the folder of a workspace for its tests.',
    ],
  )
  // A root with colors gives them to the run of each workspace,
  // through its pipe.
  const colored = spawnSync('node', [cli], {
    cwd: p.dir,
    encoding: 'utf8',
    env: { ...process.env, CI: '', UBQ_COLOR: '1' },
  })
  assert.match(colored.stdout, /^\x1b\[40;31mFAIL\x1b\[m one\.test\.ts > one$/m)
  // A command for all workspaces.
  assert.equal(
    p
      .ubq('--failed')
      .out.replace(/ \(run \d+[^)]*\)/g, '')
      .split('\n')
      .filter(l => /^(pass|fail|workspaces)/.test(l))
      .join('|'),
    'fail: 1 failed, 0 passed|workspaces: 1 of 1 failed: packages/b. Run ubq in the folder of a workspace for its tests.',
  )
  writeFileSync(
    join(p.dir, 'packages/b/one.test.ts'),
    `import { assert, test } from 'ubqtest'\ntest('one', () => assert(true))\n`,
  )
  assert.equal(p.ubq().out.split('\n').at(-2), 'workspaces: 2 passed')
  // pnpm has the list in its own file. A pattern with ! leaves a
  // folder out.
  writeFileSync(join(p.dir, 'package.json'), JSON.stringify({ type: 'module' }))
  assert.equal(p.ubq().code, 2)
  writeFileSync(
    join(p.dir, 'pnpm-workspace.yaml'),
    'minimumReleaseAge: 1440\npackages:\n  - \'packages/*\' # each project\n  - "!packages/b"\ncatalog:\n  - not/a/package\n',
  )
  assert.equal(p.ubq().out.split('\n').at(-2), 'workspaces: 1 passed')
  assert.match(
    p.ubq('doctor').out,
    /^note this folder is the root of a monorepo with 2 projects \(packages\/a, packages\/empty\)\. ubq runs the tests of one project: /m,
  )
  // More than 3 projects: the note names 3.
  for (const name of ['c', 'd']) {
    mkdirSync(join(p.dir, 'packages', name))
    writeFileSync(join(p.dir, 'packages', name, 'package.json'), JSON.stringify({ name, type: 'module' }))
  }
  assert.match(
    p.ubq('doctor').out,
    /^note this folder is the root of a monorepo with 4 projects \(packages\/a, packages\/c, packages\/d, \.\.\.\)\. /m,
  )
  for (const name of ['c', 'd']) rmSync(join(p.dir, 'packages', name), { recursive: true })
  // No workspace has tests.
  for (const name of ['a', 'b']) rmSync(join(p.dir, 'packages', name, 'one.test.ts'))
  assert.equal(p.ubq().code, 2)
  rmSync(p.dir, { recursive: true })
})
