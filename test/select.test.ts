// Selection of tests: by ID, and by the result of the last run.
import { appendFileSync, cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assert, test } from 'ubqtest'
import { project } from './setup.ts'

test('a test ID selects one test, and a group ID selects its tests', () => {
  const p = project()
  p.set('pass')
  const one = p.ubq('flip.ts > c')
  assert.deepEqual([one.code, one.last, one.err], [0, 'pass: 0 failed, 1 passed, 2 not selected', ''])
  assert.equal(p.ubq('flip.ts > group').last, 'pass: 0 failed, 2 passed, 1 not selected')
  assert.equal(p.ubq('flip.ts > group > b', 'flip.ts > c').last, 'pass: 0 failed, 2 passed, 1 not selected')
  assert.equal(p.ubq('flip.ts > c', 'pass.ts').last, 'pass: 0 failed, 6 passed, 1 skipped, 2 not selected')
  const none = p.ubq('flip.ts > nope')
  assert.equal(none.code, 2)
  assert.match(none.out, /no test of this file has an ID in the selection\. The IDs in this file are:\n  flip\.ts > group > a\n/)
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
  assert.equal(p.ubq('--failed').last, 'pass: 0 failed, 1 passed, 2 not selected')
  // Now no test has a failure as its last result.
  assert.deepEqual([p.ubq('--failed').code, p.ubq('--failed').err], [2, 'ubq: no test failed in its last run\n'])
  assert.equal(p.ubq('--failed', 'flip.ts').code, 4)
  assert.equal(p.ubq('--nope').code, 4)
  rmSync(p.dir, { recursive: true })
})

test('--changed runs the test files that loaded a changed file', () => {
  const p = project()
  p.set('pass')
  assert.equal(p.ubq('flip.ts', 'pass.ts').last, 'pass: 0 failed, 8 passed, 1 skipped')
  const none = p.ubq('--changed')
  assert.equal(none.code, 2)
  assert.match(none.err, /^ubq: no file that a test loaded has changed/)

  // Only pass.ts loads src/shape.ts.
  appendFileSync(join(p.dir, 'src/shape.ts'), '\n// a change\n')
  assert.equal(p.ubq('--changed').out.replace(/ \(run \d+\)/, ''), [
    'changed: src/shape.ts',
    'skip pass.ts > not on this platform: needs a GPU',
    'pass: 0 failed, 5 passed, 1 skipped',
    '',
  ].join('\n'))
  assert.equal(p.ubq('--changed').code, 2)

  // A change to a test file, and a new test file.
  appendFileSync(join(p.dir, 'flip.ts'), '\n// a change\n')
  mkdirSync(join(p.dir, 'test'))
  cpSync(join(p.dir, 'flip.ts'), join(p.dir, 'test/new.test.ts'))
  const both = p.ubq('--changed')
  assert.equal(both.out.split('\n')[0], 'changed: flip.ts, test/new.test.ts')
  assert.equal(both.last, 'pass: 0 failed, 6 passed')
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
  assert.equal(p.ubq().last, 'pass: 0 failed, 6 passed')
  writeFileSync(join(p.dir, 'other/package.json'), '{}')
  assert.equal(p.ubq().last, 'pass: 0 failed, 3 passed')
  const r = p.ubq('other')
  assert.deepEqual([r.code, r.err], [
    4,
    'ubq: other is a different project: it has its own package.json. Run ubq in that folder, or name its test files.\n',
  ])
  // A file that is an argument always runs.
  assert.equal(p.ubq('other/test/b.test.ts').last, 'pass: 0 failed, 3 passed')
  rmSync(p.dir, { recursive: true })
})

test('the ubq key of package.json sets include, exclude, and timeout', () => {
  const p = project()
  p.set('pass')
  mkdirSync(join(p.dir, 'test/slow'), { recursive: true })
  cpSync(join(p.dir, 'flip.ts'), join(p.dir, 'test/a.test.ts'))
  cpSync(join(p.dir, 'flip.ts'), join(p.dir, 'test/slow/b.test.ts'))
  assert.equal(p.ubq().last, 'pass: 0 failed, 6 passed')

  p.configure({ exclude: ['test/slow/**'] })
  assert.equal(p.ubq().last, 'pass: 0 failed, 3 passed')
  // A file that is an argument always runs.
  assert.equal(p.ubq('test/slow/b.test.ts').last, 'pass: 0 failed, 3 passed')

  // `include` replaces the name pattern.
  p.configure({ include: ['flip.ts', 'test/**'], exclude: ['test/slow/**'] })
  assert.equal(p.ubq().last, 'pass: 0 failed, 6 passed')
  assert.equal(p.ubq('test').last, 'pass: 0 failed, 3 passed')

  writeFileSync(join(p.dir, 'wait.ts'), [
    "import { assert, test } from 'ubqtest'",
    "test('waits', async () => { assert.equal(1, 1); await new Promise(r => setTimeout(r, 300)) })",
  ].join('\n'))
  p.configure({ timeout: 50 })
  assert.match(p.ubq('wait.ts').out, /the test did not end in 50 ms/)
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
    'ubq: unknown key "testMatch" in "ubq" in package.json. The keys are: include, exclude, timeout, hangRerun, bunInspectorCoverage, browser\n',
  ])
  assert.deepEqual(err({ include: 'test' }), [
    4,
    'ubq: "ubq.include" in package.json must be a list of glob patterns, such as ["test/**/*.test.ts"]\n',
  ])
  assert.deepEqual(err({ timeout: '5s' }, 'flip.ts', 'pass.ts'), [
    4,
    'ubq: "ubq.timeout" in package.json must be a number of milliseconds, such as 5000\n',
  ])
  rmSync(p.dir, { recursive: true })
})

test('at the root of a monorepo with no tests, ubq runs each workspace', () => {
  const p = project()
  writeFileSync(join(p.dir, 'package.json'), JSON.stringify({ type: 'module', workspaces: ['packages/*'] }))
  for (const [name, value] of [['a', 1], ['b', 2], ['empty', 0]] as const) {
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
  assert.deepEqual(r.out.replace(/ \(run \d+\)/g, '').split('\n').filter(l => /^(workspace|pass|fail|FAIL)/.test(l)), [
    'workspace packages/a:',
    'pass: 0 failed, 1 passed',
    'workspace packages/b:',
    'FAIL one.test.ts > one',
    'fail: 1 failed, 0 passed',
    'workspace packages/empty:',
    'workspaces: 1 of 2 failed: packages/b. Run ubq in the folder of a workspace for its tests.',
  ])
  // A command for all workspaces.
  assert.equal(p.ubq('--failed').out.replace(/ \(run \d+\)/g, '').split('\n').filter(l => /^(pass|fail|workspaces)/.test(l)).join('|'), 'fail: 1 failed, 0 passed|workspaces: 1 of 1 failed: packages/b. Run ubq in the folder of a workspace for its tests.')
  rmSync(p.dir, { recursive: true })
})

