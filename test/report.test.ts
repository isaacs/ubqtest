// `ubq report`: what the tests show about a change, as markdown.
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assert, cleanup, test } from 'ubqtest'
import { project, remove } from './setup.ts'

const SRC = 'export const add = (a: number, b: number): number => a + b\n'
const TEST = `import { assert, test } from 'ubqtest'
import { add } from '../lib/math.ts'
test('add', () => assert.equal(add(1, 2), 3))
test('zero', () => assert.equal(add(0, 0), 0))
`

const setup = (git: boolean) => {
  const p = project()
  cleanup(() => remove(p.dir))
  mkdirSync(join(p.dir, 'lib'))
  mkdirSync(join(p.dir, 'test'))
  writeFileSync(join(p.dir, 'lib/math.ts'), SRC)
  writeFileSync(join(p.dir, 'test/math.test.ts'), TEST)
  const run = (...args: string[]) =>
    spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], {
      cwd: p.dir,
    })
  if (git) {
    writeFileSync(join(p.dir, '.gitignore'), 'node_modules\n.ubq\n')
    run('init', '-q')
    run('add', '.')
    run('commit', '-q', '-m', 'first')
  }
  return { ...p, file: (name: string) => join(p.dir, name) }
}

test('ubq report: a pass, and a change with a removed test and a failure', () => {
  const p = setup(true)
  assert.equal(p.ubq().code, 0)
  let r = p.ubq('report')
  assert.equal(r.code, 0)
  assert.equal(
    r.out,
    [
      '### Tests',
      '',
      '**pass**: the last result of each test is a pass, and is the result of the code as it is now, and each changed line ran in a test (run 1)',
      '',
      '- Last run (run 1): 0 failed, 2 passed.',
      '- Changes to the tests to look at (`ubq review`, from the last commit): none.',
      '',
    ].join('\n'),
  )

  writeFileSync(
    p.file('test/math.test.ts'),
    TEST.replace("test('zero', () => assert.equal(add(0, 0), 0))\n", '').replace(', 3)', ', 4)'),
  )
  assert.equal(p.ubq().code, 1)
  r = p.ubq('report')
  assert.equal(r.code, 0)
  assert.equal(
    r.out.replace(/\b[0-9a-f]{7}\b/, 'HASH'),
    [
      '### Tests',
      '',
      '**fail**: 1 failed tests (run 2)',
      '',
      '```text',
      '1 tests failed in their last run: test/math.test.ts > add. To see them: ubq failures',
      'After a fix, run: ubq --failed',
      '```',
      '',
      '- Last run (run 2): 1 failed, 0 passed.',
      '- Changes to the tests to look at (`ubq review`, from the last commit): 2.',
      '',
      '```text',
      'removed: test/math.test.ts > zero (test/math.test.ts:4 in HASH)',
      'assertions changed: test/math.test.ts > add (test/math.test.ts:3)',
      '  - assert.equal(add(1, 2), 3)',
      '  + assert.equal(add(1, 2), 4)',
      '```',
      '',
    ].join('\n'),
  )
})

test('ubq report: no store, no git, and a wrong argument', () => {
  const p = setup(false)
  let r = p.ubq('report')
  assert.equal(r.out, '### Tests\n\n**fail**: no run\n\n```text\nno run is stored. Run the tests: ubq\n```\n')
  assert.equal(p.ubq('test/math.test.ts').code, 0)
  r = p.ubq('report')
  assert.match(r.out, /^- Last run \(run 1\): 0 failed, 2 passed\.$/m)
  assert(!r.out.includes('ubq review'))
  r = p.ubq('report', 'now')
  assert.equal(r.code, 4)
  assert.equal(r.err, 'ubq: ubq report takes --diff=<commit>, not: now\n')
})
