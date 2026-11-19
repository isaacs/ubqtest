// A test file that does not load: a syntax error, or an import of a
// file that does not exist.
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assert, cleanup, test } from 'ubqtest'
import { projectRoot } from '../src/project.ts'
import { loadFailure } from '../src/runner.ts'
import { addBare, addDefine, project, remove } from './setup.ts'

test('a test file that does not load is an error of the file, with the place', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  writeFileSync(join(p.dir, 'bad.ts'), "import { test } from 'ubqtest'\ntest('x', () => {\n  const a = (\n})\n")
  writeFileSync(join(p.dir, 'missing.ts'), "import { test } from 'ubqtest'\nimport './nope.ts'\ntest('x', () => {})\n")
  const blocks = (...args: string[]) => {
    const r = p.ubq(...args)
    return [
      r.code,
      ...r.out
        .replace(/ \(run \d+\)\n$/, '')
        .split('\n')
        .filter(l => l && !l.startsWith('For the same test order')),
    ]
  }
  const bad = ['ERROR bad.ts', '  the test file did not load: Expression expected', '  at bad.ts:4:1', '  > })']
  const missing = [
    'ERROR missing.ts',
    "  the test file did not load: Cannot find module 'nope.ts' imported from missing.ts",
  ]
  // One file runs in the process of the runner.
  assert.deepEqual(blocks('bad.ts'), [1, ...bad, 'fail: 1 errors, 0 failed, 0 passed'])
  assert.deepEqual(blocks('missing.ts'), [1, ...missing, 'fail: 1 errors, 0 failed, 0 passed'])
  // In a child process.
  assert.deepEqual(
    blocks('--seed', '1', 'bad.ts', 'missing.ts', 'pass.ts').sort(),
    [
      1,
      ...bad,
      ...missing,
      'skip pass.ts > not on this platform: needs a GPU',
      'fail: 2 errors, 0 failed, 5 passed, 1 skipped',
    ].sort(),
  )
  // The store has the errors.
  const again = p.ubq('failures').out.split('\n')
  assert.deepEqual(again.slice(again.indexOf(bad[0]!), again.indexOf(bad[0]!) + 4), bad)
})

test('a hook of an other test tool gets a hint', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  writeFileSync(join(p.dir, 'hook.ts'), "import { test } from 'ubqtest'\nafterEach(() => {})\ntest('x', () => {})\n")
  assert.contains(
    p.ubq('hook.ts').out,
    'ReferenceError: afterEach is not defined. ubq has no hooks. Make a setup function and call it in each test. Use cleanup() for the work after a test. ubq convert leaves a TODO(ubq) at each hook.\n  at hook.ts:2:1',
  )
})

test('an import of ./a.js finds the file ./a.ts', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  writeFileSync(
    join(p.dir, 'src/one.ts'),
    "import { two } from './two.js'\nexport const one = (): number => two() - 1\n",
  )
  writeFileSync(join(p.dir, 'src/two.ts'), 'export const two = (): number => 2\n')
  writeFileSync(
    join(p.dir, 'one.ts'),
    "import { assert, test } from 'ubqtest'\nimport { one } from './src/one.js'\ntest('one', () => {\n  assert.equal(one(), 1)\n})\n",
  )
  // In the process of the runner, and in a child process.
  assert.equal(p.ubq('one.ts').last, 'pass: 0 failed, 1 passed')
  assert.equal(p.ubq('one.ts', 'pass.ts').last, 'pass: 0 failed, 6 passed, 1 skipped')
  assert.equal(p.ubq('covers', 'src/two.ts:1').out, 'one.ts > one\none.ts (while the file loads)\n')
  // A file that does not exist with either name.
  writeFileSync(join(p.dir, 'src/two.ts'), "import './three.js'\n")
  assert.match(
    p.ubq('one.ts').out,
    /the test file did not load: Cannot find module 'src\/three.js' imported from src\/two.ts/,
  )
  // Syntax that Node cannot run: the report says what to do.
  writeFileSync(join(p.dir, 'src/two.ts'), 'export enum Two {\n  A,\n}\nexport const two = (): number => 2\n')
  assert.deepEqual(p.ubq('one.ts').out.split('\n').slice(0, 4), [
    'ERROR one.ts',
    '  the test file did not load: TypeScript enum is not supported in strip-only mode. Node runs only TypeScript syntax that can be erased. Do not choose for the person who owns the project. Ask them: change this syntax, run the tests on Bun (bun node_modules/ubqtest/cli.js), or test a build of the source.',
    '  at src/two.ts:1:1',
    '  > export enum Two {',
  ])
})

test('an import with no extension finds the file, and an import of a folder finds its index file', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  addBare(p.dir)
  // In the process of the runner, and in a child process.
  assert.equal(p.ubq('one.ts').last, 'pass: 0 failed, 2 passed')
  assert.equal(p.ubq('one.ts', 'pass.ts').last, 'pass: 0 failed, 7 passed, 1 skipped')
  // Also in the new instance of a mock.
  assert.equal(p.ubq('covers', 'src/two.ts:1').out, 'one.ts > mock\none.ts > one\none.ts (while the file loads)\n')
  // `require` too, also for the name of the file after a build.
  writeFileSync(
    join(p.dir, 'req.cts'),
    [
      "const { assert, test } = require('ubqtest')",
      "const { two } = require('./src/two')",
      "const { three } = require('./src/dir')",
      "test('req', () => {",
      '  assert.equal(three() - two(), 1)',
      "  assert.equal(require('./src/two.js').two, two)",
      '})',
      '',
    ].join('\n'),
  )
  // The resolve hook of Node gets a `require` with no extension in
  // Node 24.18 and later of Node 24, and in Node 26.5 (D100).
  const [major, minor] = spawnSync('node', ['-p', 'process.versions.node'], { encoding: 'utf8' })
    .stdout.split('.')
    .map(Number) as [number, number]
  if (major === 24 ? minor >= 18 : major > 26 || (major === 26 && minor >= 5))
    assert.equal(p.ubq('req.cts').last, 'pass: 0 failed, 1 passed')
  // A name with no file: the report has the name as it is written.
  writeFileSync(join(p.dir, 'src/two.ts'), "import './three'\n")
  assert.match(
    p.ubq('one.ts').out,
    /the test file did not load: Cannot find module 'src\/three' imported from src\/two.ts/,
  )
})

test('the place of a load error in a folder whose name has a space', () => {
  const path = join(projectRoot(), 'sub dir', 'a b.ts')
  const url = pathToFileURL(path).href
  const at = { file: 'sub dir/a b.ts', line: 4, column: 1 }
  const texts = [
    // Bun
    `error: Expected ";"\n    at ${path}:4:1`,
    // Deno: a URL, with %20 for a space
    `error: Uncaught SyntaxError: Expected ";"\n    at ${url}:4:1`,
    // Node: the URL and the line, then the source line
    `${url}:4\n})\n^\n\nSyntaxError: Expected ";"`,
    // A path of Windows in the project
    `error: Expected ";"\n    at sub dir\\a b.ts:4:1`,
  ]
  for (const text of texts) assert.deepEqual(loadFailure(text)?.at, at, text)
  // A URL that is not valid stays as it is.
  assert.deepEqual(loadFailure('error: bad file://[x\n    at file://[x:4:1'), {
    kind: 'error',
    message: 'the test file did not load: bad file://[x',
  })

  // A run of such a file.
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  mkdirSync(join(p.dir, 'sub dir'))
  writeFileSync(join(p.dir, 'sub dir/a b.ts'), "import { test } from 'ubqtest'\ntest('x', () => {\n  const a = (\n})\n")
  assert.deepEqual(p.ubq('sub dir/a b.ts').out.split('\n').slice(0, 3), [
    'ERROR sub dir/a b.ts',
    '  the test file did not load: Expression expected',
    '  at sub dir/a b.ts:4:1',
  ])
})

test('a file that throws before it has a test has one error, not a second one for no tests', () => {
  const p = project()
  cleanup(() => remove(p.dir))
  writeFileSync(join(p.dir, 'throws.test.ts'), "import { test } from 'ubqtest'\nthrow new Error('boom')\n")
  writeFileSync(join(p.dir, 'empty.test.ts'), "import 'ubqtest'\n")
  const r = p.ubq('throws.test.ts', 'empty.test.ts')
  assert.equal(r.last, 'fail: 2 errors, 0 failed, 0 passed')
  assert.equal(r.out.match(/^ERROR throws\.test\.ts$/gm)?.length, 1)
  assert(!/^ERROR throws\.test\.ts\n {2}the file registered no tests/m.test(r.out))
  // A file with no test and no error still has the error for no tests.
  assert.match(r.out, /^ERROR empty\.test\.ts\n {2}the file registered no tests$/m)
})

test('the values of the define key are globals before the source loads', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  addDefine(p)
  const file = readFileSync(join(p.dir, 'flag.ts'), 'utf8')
  writeFileSync(join(p.dir, 'flag2.ts'), file)
  // In the process of the runner, in a child process, and as a plain program.
  assert.equal(p.ubq('flag.ts').last, 'pass: 0 failed, 1 passed')
  assert.equal(p.ubq('flag.ts', 'flag2.ts').last, 'pass: 0 failed, 2 passed')
  // A plain program sets them when it loads ubqtest.
  const [source, ubqtest, ...rest] = file.split('\n')
  writeFileSync(join(p.dir, 'plain.ts'), [ubqtest, source, ...rest].join('\n'))
  const plain = spawnSync('node', ['plain.ts'], { cwd: p.dir, encoding: 'utf8' })
  assert.equal(plain.status, 0, plain.stderr)
})

test('a run with no cache makes the cache of the test files and of the files that they import, with no types', () => {
  const p = project()
  cleanup(() => remove(p.dir))
  mkdirSync(join(p.dir, 'lib/dir'), { recursive: true })
  writeFileSync(
    join(p.dir, 'lib/shared.ts'),
    "import { one } from './dir'\nexport const two = (): number => one() + 1\n",
  )
  writeFileSync(join(p.dir, 'lib/dir/index.ts'), 'export const one = (): number => 1\n')
  // Node cannot remove the types of this file. No test loads it.
  writeFileSync(join(p.dir, 'lib/kind.ts'), 'export enum Kind {\n  A,\n}\n')
  for (const name of ['a', 'b'])
    writeFileSync(
      join(p.dir, `${name}.test.ts`),
      `import { assert, test } from 'ubqtest'
import { two } from './lib/shared.js'
const kind = (): Promise<unknown> => import('./lib/kind.ts')
test('${name}', () => assert.deepEqual([two(), typeof kind], [2, 'function']))
`,
    )
  const r = p.ubq('a.test.ts', 'b.test.ts')
  assert.deepEqual([r.last, r.err], ['pass: 0 failed, 2 passed', ''])
  // One entry for each file: the two test files, and the three
  // files of `lib`. Each has the source with no types, but the file
  // that Node cannot change.
  const dir = join(p.dir, '.ubq/counters')
  const entries = readdirSync(dir).map(
    name => JSON.parse(readFileSync(join(dir, name), 'utf8')) as { code: string; js?: string },
  )
  assert.deepEqual(entries.map(entry => (entry.code.includes('enum Kind') ? 'no js' : typeof entry.js)).sort(), [
    'no js',
    'string',
    'string',
    'string',
    'string',
  ])
  assert(entries.every(entry => !entry.js?.includes(': number')))
})
