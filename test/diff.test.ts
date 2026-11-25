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
  p.configure({ include: ['pass.ts'] })
  const path = join(p.dir, 'src/shape.ts')
  const edit = (from: string, to: string) => {
    const text = readFileSync(path, 'utf8')
    assert(text.includes(from))
    writeFileSync(path, text.replace(from, to))
  }
  const lines = (...args: string[]) => {
    const r = p.ubq(...args)
    return (r.out + r.err)
      .replace(/ \(run \d+[^)]*\)/, '')
      .trimEnd()
      .split('\n')
  }
  return { ...p, edit, lines }
}

test('--changed also runs each test that failed in its last run', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  p.configure({ include: ['flip.ts', 'pass.ts', '*.test.ts'] })
  p.set('fail')
  assert.equal(p.ubq('flip.ts', 'pass.ts').last, 'fail: 1 failed, 7 passed, 1 skipped')
  // No file of the project changed: the test reads a file that is
  // not code. Its last result is a failure, so it runs.
  p.set('pass')
  assert.equal(p.ubq('--changed').last, 'pass: 1 test, 2 not selected')
  assert.equal(p.ubq('--changed').err, 'ubq: no changes, no new tests, no failed tests\n')
  // With a change for a different test of the file, the two run.
  p.set('fail')
  p.ubq('flip.ts')
  p.set('pass')
  writeFileSync(join(p.dir, 'flip.ts'), readFileSync(join(p.dir, 'flip.ts'), 'utf8') + '\n')
  assert.equal(p.ubq('--changed').last, 'pass: 3 tests')
  // A change for one test of a file, and a failed test in it: the
  // two run, and the third test does not.
  writeFileSync(join(p.dir, 'src/n.ts'), 'export const n = (): number => 1\n')
  writeFileSync(
    join(p.dir, 'three.test.ts'),
    `import { readFileSync } from 'node:fs'
import { assert, test } from 'ubqtest'
import { n } from './src/n.ts'
test('x', () => assert.equal(readFileSync(process.env.FLIP_FILE!, 'utf8'), 'pass'))
test('y', () => assert.equal(n(), 1))
test('z', () => assert(true))
`,
  )
  p.set('fail')
  assert.equal(p.ubq('three.test.ts').last, 'fail: 1 failed, 2 passed')
  p.set('pass')
  writeFileSync(join(p.dir, 'src/n.ts'), 'export const n = (): number => 2 - 1\n')
  assert.equal(p.ubq('--changed').last, 'pass: 2 tests, 1 not selected')
})

test('--changed runs only the tests that ran the code that changed', () => {
  const p = setup()
  p.edit('export const load', 'export const never = (): number => 1\n\nexport const load')
  assert.equal(p.ubq('pass.ts').last, 'pass: 5 tests, 1 skipped')
  p.edit("'unknown shape: ?'", "'unknown shape: ?' + ''")
  assert.deepEqual(p.lines('--changed'), ['changed: src/shape.ts', 'pass: 1 test, 5 not selected'])
  p.edit('side: 2', 'side: 1 + 1')
  // `kind of s` and `load` ran that line.
  assert.deepEqual(p.lines('--changed'), ['changed: src/shape.ts', 'pass: 2 tests, 4 not selected'])
  assert.deepEqual(p.lines('--changed'), ['ubq: no changes, no new tests, no failed tests'])
  // The coverage of the tests that did not run has the places of
  // the new content.
  assert.deepEqual(p.lines('covers', 'src/shape.ts:8'), ['pass.ts > load', 'pass.ts > parse > unknown input'])
  assert.deepEqual(p.lines('uncovered', 'src/shape.ts'), [
    'src/shape.ts:12:22  (): number => 1',
    '1 uncovered range in src/shape.ts',
  ])
  // A change in code that no test ran.
  p.edit('never = (): number => 1', 'never = (): number => 2')
  assert.deepEqual(p.lines('--changed'), ['ubq: no tests for changes in src/shape.ts'])
  assert.deepEqual(p.lines('uncovered', 'src/shape.ts')[0], 'src/shape.ts:12:22  (): number => 2')
  // Code that runs while the test file loads can change each test.
  p.edit('export const load', 'export const more = 1\nexport const load')
  assert.deepEqual(p.lines('--changed').slice(-1), ['pass: 5 tests, 1 skipped'])
})

test('--diff of uncovered and mutate: only the lines that differ from a git commit', () => {
  const p = setup()
  const git = (...args: string[]) => {
    const r = spawnSync(
      'git',
      ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args],
      {
        cwd: p.dir,
        encoding: 'utf8',
      },
    )
    assert.equal(r.status, 0, r.stderr)
  }
  writeFileSync(join(p.dir, '.gitignore'), 'node_modules\n.ubq\n')
  git('init', '-q')
  git('add', '.')
  git('commit', '-q', '-m', 'first')
  assert.equal(p.ubq('pass.ts').last, 'pass: 5 tests, 1 skipped')
  assert.deepEqual(p.lines('uncovered', '--diff'), ['uncovered: none'])

  p.edit(
    "return { kind: 'square', side: 2 }",
    "return s.length > 1 ? { kind: 'square', side: 3 } : { kind: 'square', side: 2 }",
  )
  writeFileSync(join(p.dir, 'src/new.ts'), 'export const fresh = 1\n')
  assert.deepEqual(p.lines('uncovered', '--diff'), [
    'ubq: src/shape.ts changed after the last run of its tests. Run them first: ubq --changed',
  ])
  p.ubq('--changed')
  assert.deepEqual(p.lines('uncovered', '--diff'), [
    "src/shape.ts:7:38  ? { kind: 'square', side: 3 }",
    'src/new.ts  no test loads this file',
    '1 uncovered range in the changed lines of 1 file, 1 changed file that no test loads',
  ])
  assert.deepEqual(p.lines('mutate', '--diff'), [
    'mutate: 0 of 4 changes survived, 1 more are in code that no passing test runs (ubq uncovered)',
  ])
  git('add', '.')
  git('commit', '-q', '-m', 'second')
  assert.deepEqual(p.lines('uncovered', '--diff'), ['uncovered: none'])
  // A file with no change since the commit.
  assert.deepEqual(p.lines('mutate', '--diff', 'src/shape.ts'), ['mutate: 0 of 0 changes survived'])
  // A file that went away has no lines in the diff.
  rmSync(join(p.dir, 'src/new.ts'))
  assert.deepEqual(p.lines('uncovered', '--diff'), ['uncovered: none'])
  writeFileSync(join(p.dir, 'src/new.ts'), 'export const fresh = 1\n')
  assert.deepEqual(p.lines('uncovered', '--diff=HEAD~1', 'src/shape.ts'), [
    "src/shape.ts:7:38  ? { kind: 'square', side: 3 }",
    '1 uncovered range in the changed lines of 1 file',
  ])
  assert.deepEqual(p.lines('uncovered', '--diff=nope'), ["ubq: --diff: fatal: bad revision 'nope'"])
})

test('--diff finds a file whose name git puts in quotes', () => {
  const p = setup()
  const git = (...args: string[]) => {
    const r = spawnSync(
      'git',
      ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args],
      {
        cwd: p.dir,
        encoding: 'utf8',
      },
    )
    assert.equal(r.status, 0, r.stderr)
  }
  // Windows does not allow these characters in a file name. Git
  // writes a tab as `\t`, and the other control characters in octal.
  const names = [
    'a b.ts',
    'é.ts',
    ...(process.platform === 'win32' ? [] : ['q"t.ts', 'b\\s.ts', 'c\td.ts', 'd\x01e.ts']),
  ]
  writeFileSync(join(p.dir, '.gitignore'), 'node_modules\n.ubq\n')
  for (const name of names) writeFileSync(join(p.dir, 'src', name), 'export const x = 1\n')
  git('init', '-q')
  git('add', '.')
  git('commit', '-q', '-m', 'first')
  assert.equal(p.ubq('pass.ts').last, 'pass: 5 tests, 1 skipped')
  // A changed file, and a new file, for each name.
  for (const name of names) {
    writeFileSync(join(p.dir, 'src', name), 'export const x = 2\n')
    writeFileSync(join(p.dir, 'src', `new ${name}`), 'export const y = 1\n')
  }
  const listed = p.lines('uncovered', '--diff').filter(line => line.endsWith('  no test loads this file'))
  assert.deepEqual(
    listed.sort(),
    names.flatMap(name => [`src/${name}  no test loads this file`, `src/new ${name}  no test loads this file`]).sort(),
  )
})
