// `ubq review`: the changes to the tests that a person must look at.
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assert, cleanup, test } from 'ubqtest'
import { project, remove } from './setup.ts'

const SRC = `export const add = (a: number, b: number): number => a + b
export const sub = (a: number, b: number): number => a - b
`
const TEST = `import { assert, describe, test } from 'ubqtest'
import { add, sub } from '../lib/math.ts'
describe('math', () => {
  test('add', () => {
    assert.equal(add(1, 2), 3)
    assert.equal(add(2, 2), 4)
  })
  test('sub', () => assert.equal(sub(3, 1), 2))
  test('neg', () => assert.equal(sub(1, 3), -2))
  test('old name', () => assert(sub(0, 0) === 0))
  test('snap', () => assert.snapshot({ a: add(1, 1) }))
})
`

/** A project in git with one source file and one test file, and a run with its snapshots. */
const setup = () => {
  const p = project()
  cleanup(() => remove(p.dir))
  mkdirSync(join(p.dir, 'lib'))
  mkdirSync(join(p.dir, 'test'))
  writeFileSync(join(p.dir, 'lib/math.ts'), SRC)
  writeFileSync(join(p.dir, 'test/math.test.ts'), TEST)
  writeFileSync(join(p.dir, '.gitignore'), 'node_modules\n.ubq\n')
  const git = (...args: string[]) => {
    const r = spawnSync(
      'git',
      ['-c', 'user.name=t', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args],
      { cwd: p.dir, encoding: 'utf8' },
    )
    assert.equal(r.status, 0, r.stderr)
    return r.stdout.trim()
  }
  assert.equal(p.ubq('--update', 'test/math.test.ts').code, 0)
  git('init', '-q', '-b', 'main')
  git('add', '.')
  git('commit', '-q', '-m', 'first')
  const review = (...args: string[]) => {
    const r = p.ubq('review', ...args)
    // The hash of a commit changes with each run.
    return { ...r, out: r.out.replace(/\b[0-9a-f]{7}\b/g, 'HASH') }
  }
  return { ...p, git, review, file: (name: string) => join(p.dir, name) }
}

test('ubq review: removed, skipped, and weaker tests, changed snapshots, and new not measured comments', () => {
  const p = setup()
  let r = p.review()
  assert.equal(r.code, 0)
  assert.equal(r.out, 'review: no test removed, skipped, or with changed assertions, from the last commit\n')

  // The code changes, and the tests follow it.
  writeFileSync(
    p.file('lib/math.ts'),
    SRC.replace('a + b\n', 'a + b + 1\n') + '// ubq: not measured: hard to test\nexport const x = 1\n',
  )
  writeFileSync(
    p.file('test/math.test.ts'),
    TEST.replace('    assert.equal(add(1, 2), 3)\n    assert.equal(add(2, 2), 4)\n', '    assert.equal(add(1, 2), 4)\n')
      .replace("test('sub', () =>", "test('sub', { skip: 'flaky' }, () =>")
      .replace("  test('neg', () => assert.equal(sub(1, 3), -2))\n", '')
      .replace("'old name'", "'new name'"),
  )
  assert.equal(p.ubq('--update', 'test/math.test.ts').code, 0)
  r = p.review()
  assert.equal(r.code, 1)
  assert.equal(
    r.out,
    [
      'removed: test/math.test.ts > math > neg (test/math.test.ts:9 in HASH)',
      'skipped: test/math.test.ts > math > sub (test/math.test.ts:7), skip: flaky',
      'fewer assertions: test/math.test.ts > math > add (test/math.test.ts:4), 2 before, 1 now. The test runs code that changed: lib/math.ts:1',
      '  - assert.equal(add(1, 2), 3)',
      '  - assert.equal(add(2, 2), 4)',
      '  + assert.equal(add(1, 2), 4)',
      'snapshot changed: test/math.test.ts > math > snap 1. To see it: git diff HASH -- ubq-snapshots/test/math.test.ts.snap',
      'not measured: lib/math.ts: hard to test',
      'review: 5 changes to the tests for a person to look at, from the last commit',
      '',
    ].join('\n'),
  )
})

test('ubq review: changed assertions, conditional skips, a moved file, and names that review cannot know', () => {
  const p = setup()
  p.git('mv', 'test/math.test.ts', 'test/m.test.ts')
  // A moved file with the same tests: nothing to look at.
  let r = p.review()
  assert.equal(r.code, 0)

  writeFileSync(
    p.file('test/m.test.ts'),
    TEST.replace('assert.equal(sub(3, 1), 2)', 'assert.equal(sub(3, 1), 2.0)')
      .replace("test('neg', () =>", "test('neg', { skip: process.platform === 'win32' && 'no' }, () =>")
      .replace(
        "describe('math', () => {",
        "describe('math', () => {\n  for (const n of [1]) test(`n ${n}`, () => assert(n))",
      ),
  )
  r = p.review()
  assert.equal(
    r.out,
    [
      "skipped: test/m.test.ts > math > neg (test/m.test.ts:10), skip: when process.platform === 'win32' && 'no'",
      'assertions changed: test/m.test.ts > math > sub (test/m.test.ts:9)',
      '  - assert.equal(sub(3, 1), 2)',
      '  + assert.equal(sub(3, 1), 2.0)',
      'review: 2 changes to the tests for a person to look at, from the last commit',
      '',
    ].join('\n'),
  )
})

test('ubq review: a removed test file, a removed snapshot, a group with a new name, and the configuration', () => {
  const p = setup()
  writeFileSync(
    p.file('test/other.test.ts'),
    "import { assert, test as it } from 'ubqtest'\nit('one', () => {\n  assert(1)\n  assert(2)\n  assert(3)\n  assert(4)\n  assert(5)\n})\n",
  )
  // Not a ubq test file, and a file that does not parse.
  writeFileSync(p.file('test/plain.ts'), "import { test } from 'node:test'\ntest('x', () => {})\n")
  writeFileSync(p.file('test/broken.test.ts'), "import { test } from 'ubqtest'\ntest('x', () => {\n")
  p.git('add', '.')
  p.git('commit', '-q', '-m', 'second')

  rmSync(p.file('test/plain.ts'))
  rmSync(p.file('test/broken.test.ts'))
  writeFileSync(
    p.file('test/other.test.ts'),
    "import { assert, test as it } from 'ubqtest'\nit('one', () => assert(1))\n",
  )
  // Each test of the group keeps its body.
  writeFileSync(
    p.file('test/math.test.ts'),
    TEST.replace("describe('math'", "describe('maths'").replace(/\n {2}test\('snap'.*\n/, '\n'),
  )
  writeFileSync(p.file('package.json'), JSON.stringify({ type: 'module', ubq: { exclude: ['test/math.test.ts'] } }))
  let r = p.review()
  assert.equal(r.code, 1)
  assert.equal(
    r.out,
    [
      'configuration: the "ubq" key of package.json changed',
      '  - (none)',
      '  + {"exclude":["test/math.test.ts"]}',
      'removed: test/math.test.ts > math > snap (test/math.test.ts:11 in HASH)',
      'fewer assertions: test/other.test.ts > one (test/other.test.ts:2), 5 before, 1 now',
      '  - assert(2)',
      '  - assert(3)',
      '  - assert(4)',
      '  - and 1 more',
      'review: 3 changes to the tests for a person to look at, from the last commit',
      '',
    ].join('\n'),
  )
  rmSync(p.file('test/math.test.ts'))
  rmSync(p.file('lib/math.ts'))
  rmSync(p.file('ubq-snapshots'), { recursive: true })
  r = p.review()
  assert.match(r.out, /^snapshot removed: test\/math\.test\.ts > math > snap 1$/m)
  assert.match(r.out, /^removed: test\/math\.test\.ts > math > add \(test\/math\.test\.ts:4 in HASH\)$/m)
  assert.match(r.out, /^review: 8 changes/m)
})

test('ubq review --diff: from where the branch left the commit', () => {
  const p = setup()
  p.git('checkout', '-q', '-b', 'work')
  p.git('checkout', '-q', 'main')
  // A newer test on main is not a removal on the branch.
  writeFileSync(p.file('test/new.test.ts'), "import { assert, test } from 'ubqtest'\ntest('new', () => assert(1))\n")
  p.git('add', '.')
  p.git('commit', '-q', '-m', 'on main')
  p.git('checkout', '-q', 'work')
  writeFileSync(p.file('test/math.test.ts'), TEST.replace("  test('neg', () => assert.equal(sub(1, 3), -2))\n", ''))
  p.git('commit', '-q', '-am', 'on the branch')
  const r = p.review('--diff=main')
  assert.equal(r.code, 1)
  assert.equal(
    r.out,
    'removed: test/math.test.ts > math > neg (test/math.test.ts:9 in HASH)\nreview: 1 changes to the tests for a person to look at, from main\n',
  )
})

test('ubq review: notes on the store, and wrong arguments', () => {
  const p = setup()
  writeFileSync(p.file('lib/math.ts'), SRC.replace('a + b\n', 'a + b + 1\n'))
  writeFileSync(p.file('test/math.test.ts'), TEST.replace('add(1, 2), 3', 'add(1, 2), 4'))
  let r = p.review()
  assert.match(
    r.out,
    /^note: code changed after the last run of its tests in lib\/math\.ts, so review does not know which tests run the changed lines\. Run: ubq --changed$/m,
  )
  rmSync(p.file('.ubq'), { recursive: true })
  r = p.review()
  assert.match(r.out, /^note: no run is stored, so review does not know which tests run the changed code\. Run: ubq$/m)

  r = p.review('--diff=nope')
  assert.equal(r.code, 4)
  assert.equal(r.err, 'ubq: ubq review needs a git commit. Not a commit here: nope\n')
  r = p.review('now')
  assert.equal(r.code, 4)
  assert.equal(r.err, 'ubq: ubq review takes --diff=<commit>, not: now\n')
})

test('ubq review: the forms of names and options, new files, and a package.json that is not JSON', () => {
  const p = setup()
  const FORMS = `import { assert, test } from 'ubqtest'
console.log('loads')
test(\`plain template\`, () => assert(1))
test('quoted key', { timeout: 100, 'skip': 'later' }, () => assert(1))
test('skip false', { skip: false }, () => assert(1))
test('timeout only', { timeout: 100 }, () => assert(1))
`
  writeFileSync(p.file('test/forms.test.ts'), FORMS)
  p.git('add', '.')
  p.git('commit', '-q', '-m', 'second')
  writeFileSync(
    p.file('test/forms.test.ts'),
    FORMS.replace('test(`plain template`, () => assert(1))', 'test(`plain template`, () => assert(2))')
      .replace("'skip': 'later'", "'skip': 'later', other: 1")
      .replace('{ skip: false }', '{ skip: false, timeout: 9 }')
      .replace('{ timeout: 100 }, () => assert(1)', "{ timeout: 100, skip: 'now' }, () => assert(1)"),
  )
  // A new file in git, and a file that git does not have yet.
  writeFileSync(p.file('lib/staged.ts'), '// ubq: not measured:\nexport const s = 1\n')
  p.git('add', 'lib/staged.ts')
  writeFileSync(p.file('lib/new.ts'), '// a comment\n/* ubq: not measured: only on a Mac */\nexport const n = 1\n')
  // Not code.
  writeFileSync(p.file('notes.md'), '// ubq: not measured: text\n')
  // The snapshots of a new test file.
  mkdirSync(p.file('ubq-snapshots/test'), { recursive: true })
  writeFileSync(p.file('ubq-snapshots/test/forms.test.ts.snap'), '')
  writeFileSync(p.file('package.json'), '{')
  const r = p.review()
  assert.equal(
    r.out,
    [
      'configuration: the "ubq" key of package.json changed',
      '  - (none)',
      '  + (not JSON)',
      'skipped: test/forms.test.ts > timeout only (test/forms.test.ts:6), skip: now',
      'assertions changed: test/forms.test.ts > plain template (test/forms.test.ts:3)',
      '  - assert(1)',
      '  + assert(2)',
      'not measured: lib/staged.ts: (no reason)',
      'not measured: lib/new.ts: only on a Mac',
      'review: 5 changes to the tests for a person to look at, from the last commit',
      '',
    ].join('\n'),
  )
})

test('ubq review: a test with a new name and its old assertions, and text that is not a comment', () => {
  const p = setup()
  writeFileSync(
    p.file('test/math.test.ts'),
    TEST.replace(
      "  test('sub', () => assert.equal(sub(3, 1), 2))",
      "  test('sub of two', { skip: 'later' }, () => {\n    assert.equal(sub(3, 1), 2)\n    assert.equal(sub(4, 1), 3)\n  })",
    ).replace("test('neg', () => assert.equal(sub(1, 3), -2))", "test('negative', () => assert(sub(1, 3) < 0))"),
  )
  // Only a comment in program code counts.
  writeFileSync(
    p.file('lib/math.ts'),
    SRC + "export const hint = '// ubq: not measured: in a string'\n// ubq: not measured: real\nexport const r = 1\n",
  )
  writeFileSync(
    p.file('test/math.test.ts'),
    readFileSync(p.file('test/math.test.ts'), 'utf8') + '// ubq: not measured: in a test\n',
  )
  const r = p.review()
  assert.equal(
    r.out,
    [
      'removed: test/math.test.ts > math > neg (test/math.test.ts:9 in HASH)',
      'skipped: test/math.test.ts > math > sub of two (was math > sub) (test/math.test.ts:8), skip: later',
      'not measured: lib/math.ts: real',
      'note: code changed after the last run of its tests in lib/math.ts, so review does not know which tests run the changed lines. Run: ubq --changed',
      'review: 3 changes to the tests for a person to look at, from the last commit',
      '',
    ].join('\n'),
  )
})
