// Commands that work on a change: `--changed` by range, and
// `--diff` of `ubq uncovered` and `ubq mutate`.
import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assert, cleanup, test } from 'ubqtest'
import { project } from './setup.ts'

const setup = () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  const path = join(p.dir, 'src/shape.ts')
  const edit = (from: string, to: string) => {
    const text = readFileSync(path, 'utf8')
    assert(text.includes(from))
    writeFileSync(path, text.replace(from, to))
  }
  const lines = (...args: string[]) => {
    const r = p.ubq(...args)
    return (r.out + r.err).replace(/ \(run \d+\)/, '').trimEnd().split('\n')
  }
  return { ...p, edit, lines }
}

test('--changed runs only the tests that ran the code that changed', () => {
  const p = setup()
  p.edit('export const load', 'export const never = (): number => 1\n\nexport const load')
  assert.equal(p.ubq('pass.ts').last, 'pass: 0 failed, 5 passed, 1 skipped')
  p.edit("'unknown shape: ?'", "'unknown shape: ?' + ''")
  assert.deepEqual(p.lines('--changed'), ['changed: src/shape.ts', 'pass: 0 failed, 1 passed, 5 not selected'])
  p.edit('side: 2', 'side: 1 + 1')
  // `kind of s` and `load` ran that line.
  assert.deepEqual(p.lines('--changed'), ['changed: src/shape.ts', 'pass: 0 failed, 2 passed, 4 not selected'])
  assert.deepEqual(p.lines('--changed'), [
    'ubq: no file that a test loaded has changed since the last run of that test, and no test file is new',
  ])
  // The coverage of the tests that did not run has the places of
  // the new content.
  assert.deepEqual(p.lines('covers', 'src/shape.ts:8'), [
    'pass.ts > load',
    'pass.ts > parse > unknown input',
    '2 tests run src/shape.ts:8',
  ])
  assert.deepEqual(p.lines('uncovered', 'src/shape.ts'), [
    'src/shape.ts:12:22  (): number => 1',
    '1 uncovered ranges in 1 files',
  ])
  // A change in code that no test ran.
  p.edit('never = (): number => 1', 'never = (): number => 2')
  assert.deepEqual(p.lines('--changed'), ['ubq: no test ran the code that changed in src/shape.ts'])
  assert.deepEqual(p.lines('uncovered', 'src/shape.ts')[0], 'src/shape.ts:12:22  (): number => 2')
  // Code that runs while the test file loads can change each test.
  p.edit('export const load', 'export const more = 1\nexport const load')
  assert.deepEqual(p.lines('--changed').slice(-1), ['pass: 0 failed, 5 passed, 1 skipped'])
})

test('--diff of uncovered and mutate: only the lines that differ from a git commit', () => {
  const p = setup()
  const git = (...args: string[]) => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args], {
      cwd: p.dir,
      encoding: 'utf8',
    })
    assert.equal(r.status, 0, r.stderr)
  }
  writeFileSync(join(p.dir, '.gitignore'), 'node_modules\n.ubq\n')
  git('init', '-q')
  git('add', '.')
  git('commit', '-q', '-m', 'first')
  assert.equal(p.ubq('pass.ts').last, 'pass: 0 failed, 5 passed, 1 skipped')
  assert.deepEqual(p.lines('uncovered', '--diff'), [
    "0 uncovered ranges in the changed lines of 0 files",
  ])

  p.edit("return { kind: 'square', side: 2 }", "return s.length > 1 ? { kind: 'square', side: 3 } : { kind: 'square', side: 2 }")
  writeFileSync(join(p.dir, 'src/new.ts'), 'export const fresh = 1\n')
  assert.deepEqual(p.lines('uncovered', '--diff'), [
    "ubq: src/shape.ts changed after the last run of its tests. Run them first: ubq --changed",
  ])
  p.ubq('--changed')
  assert.deepEqual(p.lines('uncovered', '--diff'), [
    "src/shape.ts:7:38  ? { kind: 'square', side: 3 }",
    "src/new.ts  no test loads this file",
    "1 uncovered ranges in the changed lines of 1 files, 1 changed files that no test loads",
  ])
  assert.deepEqual(p.lines('mutate', '--diff'), [
    "mutate: 0 of 4 changes survived, 1 more are in code that no passing test runs (ubq uncovered)",
  ])
  git('add', '.')
  git('commit', '-q', '-m', 'second')
  assert.deepEqual(p.lines('uncovered', '--diff'), [
    "0 uncovered ranges in the changed lines of 0 files",
  ])
  assert.deepEqual(p.lines('uncovered', '--diff=HEAD~1', 'src/shape.ts'), [
    "src/shape.ts:7:38  ? { kind: 'square', side: 3 }",
    "1 uncovered ranges in the changed lines of 1 files",
  ])
  assert.deepEqual(p.lines('uncovered', '--diff=nope'), [
    "ubq: --diff: fatal: bad revision 'nope'",
  ])
})
