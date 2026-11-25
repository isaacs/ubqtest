// A test file that does not load: a syntax error, or an import of a
// file that does not exist.
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assert, cleanup, test } from 'ubqtest'
import { projectRoot } from '../src/project.ts'
import { loadFailure } from '../src/runner.ts'
import { addBare, addDefine, cli, project, remove } from './setup.ts'

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
        .replace(/ \(run \d+[^)]*\)\n$/, '')
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
  assert.deepEqual(blocks('bad.ts'), [1, ...bad, 'fail: 1 error, 0 failed, 0 passed'])
  assert.deepEqual(blocks('missing.ts'), [1, ...missing, 'fail: 1 error, 0 failed, 0 passed'])
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

test('a hook that the file did not import gets a hint', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  writeFileSync(join(p.dir, 'hook.ts'), "import { test } from 'ubqtest'\nafterEach(() => {})\ntest('x', () => {})\n")
  assert.contains(
    p.ubq('hook.ts').out,
    "ReferenceError: afterEach is not defined. Import the hook: import { afterEach } from 'ubqtest'.\n  at hook.ts:2:1",
  )
  writeFileSync(join(p.dir, 'hook.ts'), "import { test } from 'ubqtest'\nbefore(() => {})\ntest('x', () => {})\n")
  assert.contains(
    p.ubq('hook.ts').out,
    "ReferenceError: before is not defined. Import the hook: import { beforeAll } from 'ubqtest'. before of node:test and mocha is beforeAll in ubq.",
  )
})

test('NODE_OPTIONS of the env key goes to each test process, with the options of the shell', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  p.configure({ env: { NODE_OPTIONS: '--conditions=source' } })
  // A package with an export for the condition.
  mkdirSync(join(p.dir, 'node_modules/kind'), { recursive: true })
  writeFileSync(
    join(p.dir, 'node_modules/kind/package.json'),
    JSON.stringify({ name: 'kind', type: 'module', exports: { source: './source.js', default: './built.js' } }),
  )
  writeFileSync(join(p.dir, 'node_modules/kind/source.js'), "export default 'source'\n")
  writeFileSync(join(p.dir, 'node_modules/kind/built.js'), "export default 'built'\n")
  const file = `import { spawnSync } from 'node:child_process'
// @ts-expect-error: the package has no types
import kind from 'kind'
import { assert, test } from 'ubqtest'
test('kind', () => {
  assert.equal(kind, 'source')
  assert.match(process.env.NODE_OPTIONS, /--no-warnings .*--conditions=source/)
  // A process that the test starts has the options too.
  const child = spawnSync(process.execPath, ['-e', "import('kind').then(m => console.log(m.default))"], { encoding: 'utf8' })
  assert.equal(child.stdout, 'source\\n')
})
`
  writeFileSync(join(p.dir, 'kind.ts'), file)
  writeFileSync(join(p.dir, 'kind2.ts'), file)
  const ubq = (...args: string[]) =>
    spawnSync('node', [cli, ...args], {
      cwd: p.dir,
      encoding: 'utf8',
      env: { ...process.env, CI: '', NODE_OPTIONS: '--no-warnings' },
    }).stdout.replace(/ \(run \d+\)/, '')
  // One file, which does not run in the process of the runner, and
  // two files.
  assert.equal(ubq('kind.ts'), 'pass: 1 test\n')
  assert.equal(ubq('kind.ts', 'kind2.ts'), 'pass: 2 tests\n')
  // Bun reads the condition from BUN_OPTIONS.
  if (spawnSync('bun', ['--version']).status === 0) {
    writeFileSync(
      join(p.dir, 'bun.ts'),
      "// @ts-expect-error: the package has no types\nimport kind from 'kind'\nimport { assert, test } from 'ubqtest'\ntest('kind', () => assert.equal(kind, 'source'))\n",
    )
    const bun = spawnSync('bun', [cli, 'bun.ts'], { cwd: p.dir, encoding: 'utf8', env: { ...process.env, CI: '' } })
    assert.equal(bun.stdout.replace(/ \(run \d+\)/, ''), 'pass: 1 test\n', bun.stdout)
  }
})

test('conditionsEnv gives the export conditions of NODE_OPTIONS of the env key to Bun and Deno', async () => {
  const { conditionsEnv }: typeof import('../src/config.ts') = await import('../src/config.ts?copy' as string)
  const options = '--no-warnings --conditions=source -C dev'
  assert.deepEqual(conditionsEnv(options, 'bun', {}), { BUN_OPTIONS: '--conditions=source --conditions=dev' })
  assert.deepEqual(conditionsEnv(options, 'bun', { BUN_OPTIONS: '--smol' }), {
    BUN_OPTIONS: '--smol --conditions=source --conditions=dev',
  })
  assert.deepEqual(conditionsEnv(options, 'deno', {}), { DENO_CONDITIONS: 'source,dev' })
  assert.deepEqual(conditionsEnv(options, 'deno', { DENO_CONDITIONS: 'a' }), { DENO_CONDITIONS: 'a,source,dev' })
  // Node reads NODE_OPTIONS. No condition: nothing to give.
  assert.equal(conditionsEnv(options, 'node', {}), undefined)
  assert.equal(conditionsEnv('--no-warnings', 'bun', {}), undefined)
  // The defaults: the key of this project has no NODE_OPTIONS.
  assert.equal(conditionsEnv(), undefined)
})

test('nodeOptions puts the value of the env key after the value of the process', async () => {
  // A copy of the module, which has counters: a test process loads
  // the module before the counters start.
  const { nodeOptions }: typeof import('../src/config.ts') = await import('../src/config.ts?copy' as string)
  assert.equal(nodeOptions('--b', '--a'), '--a --b')
  assert.equal(nodeOptions('--b', ''), '--b')
  // The process has it, or the key has none.
  assert.equal(nodeOptions('--b', '--a --b'), undefined)
  assert.equal(nodeOptions('', '--a'), undefined)
})

test('the text of a function from the toString of a different realm gets a hint', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  writeFileSync(
    join(p.dir, 'realm.ts'),
    `import { runInNewContext } from 'node:vm'
import { assert, test } from 'ubqtest'
const double = (n: number) => (n ? n * 2 : 0)
test('same realm', () => assert.equal(new Function('return (' + double + ')(2)')(), 4))
test('other realm', () => {
  const text = runInNewContext('f => Function.prototype.toString.call(f)')(double)
  assert.equal(new Function('return (' + text + ')(2)')(), 4)
})
`,
  )
  const out = p.ubq('realm.ts').out
  assert.contains(
    out,
    'FAIL realm.ts > other realm\n  ReferenceError: __ubqc is not defined\n  hint: the text of a function has the coverage counters of ubq, and it ran in a place that has no counters. String(fn) and fn.toString() give the text with no counters. The toString of a different realm (node:vm, an iframe) does not: get the text in the realm of the test.\n',
  )
  assert.contains(out, 'fail: 1 failed, 1 passed')
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
  assert.equal(p.ubq('one.ts').last, 'pass: 1 test')
  assert.equal(p.ubq('one.ts', 'pass.ts').last, 'pass: 6 tests, 1 skipped')
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
    '  the test file did not load: TypeScript enum is not supported in strip-only mode. Node runs only TypeScript syntax that can be erased. Change this syntax, or run `ubq doctor`: it has the three other choices for the person who owns the project.',
    '  at src/two.ts:1:1',
    '  > export enum Two {',
  ])
})

test('an import with no extension finds the file, and an import of a folder finds its index file', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  addBare(p.dir)
  // In the process of the runner, and in a child process.
  assert.equal(p.ubq('one.ts').last, 'pass: 2 tests')
  assert.equal(p.ubq('one.ts', 'pass.ts').last, 'pass: 7 tests, 1 skipped')
  // Also in the new instance of a mock.
  assert.equal(p.ubq('covers', 'src/two.ts:1').out, 'one.ts > mock\none.ts > one\none.ts (while the file loads)\n')
  // A query makes a new instance of the module, and the name still has no extension.
  writeFileSync(
    join(p.dir, 'query.ts'),
    [
      "import { assert, test } from 'ubqtest'",
      "import { two } from './src/two'",
      "test('query', async () => {",
      '  const copy = await import(`./src/two?copy=${1}`)',
      '  assert.notEqual(copy.two, two)',
      '  assert.equal(copy.two(), 2)',
      '})',
      '',
    ].join('\n'),
  )
  assert.equal(p.ubq('query.ts').last, 'pass: 1 test')
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
    assert.equal(p.ubq('req.cts').last, 'pass: 1 test')
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
  assert.equal(p.ubq('flag.ts').last, 'pass: 1 test')
  assert.equal(p.ubq('flag.ts', 'flag2.ts').last, 'pass: 2 tests')
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
  assert.deepEqual([r.last, r.err], ['pass: 2 tests', ''])
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

test('the values of the env key are in the environment before the source loads', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  p.configure({ env: { UBQ_TEST_MODE: 'dev' } })
  const file =
    "import { assert, test } from 'ubqtest'\nconst mode = process.env.UBQ_TEST_MODE\ntest('mode', () => assert.equal(mode, 'dev'))\n"
  writeFileSync(join(p.dir, 'mode.ts'), file)
  writeFileSync(join(p.dir, 'mode2.ts'), file)
  // In the process of the runner, in a child process, and as a plain program.
  assert.equal(p.ubq('mode.ts').last, 'pass: 1 test')
  assert.equal(p.ubq('mode.ts', 'mode2.ts').last, 'pass: 2 tests')
  // The value of the key is before a value of the shell: a test
  // has the same result on each machine.
  const plain = spawnSync('node', ['mode.ts'], {
    cwd: p.dir,
    encoding: 'utf8',
    env: { ...process.env, UBQ_TEST_MODE: 'prod' },
  })
  assert.equal(plain.status, 0, plain.stderr)
  p.configure({ env: { UBQ_TEST_MODE: 1 } })
  assert.equal(
    p.ubq('mode.ts').err,
    'ubq: "ubq.env" in package.json must be an object of names and text values, such as { "MODE": "dev" }\n',
  )
})

test('an import of a name that only a config maps to a path has a hint', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  const file =
    "import { assert, test } from 'ubqtest'\nimport { one } from '@lib/one'\ntest('one', () => assert.equal(one, 1))\n"
  writeFileSync(join(p.dir, 'alias.ts'), file)
  writeFileSync(join(p.dir, 'alias2.ts'), file)
  const fix =
    'Use a name that the runtime finds: the "imports" key of package.json ("#name": "./path", and import "#name"), a package of the workspace, or a relative path.'
  const hint = (...files: string[]): string | undefined =>
    p
      .ubq(...files)
      .out.split('\n')
      .find(line => line.startsWith('  hint: '))
  // No config has the name.
  assert.equal(hint('alias.ts'), undefined)
  writeFileSync(join(p.dir, 'vite.config.ts'), "export default { resolve: { alias: { '@lib': './lib' } } }\n")
  const vite = `  hint: vite.config.ts has an alias for imports, and ubq does not read it. ${fix}`
  // In the process of the runner, and in a child process.
  assert.equal(hint('alias.ts'), vite)
  assert.equal(hint('alias.ts', 'alias2.ts'), vite)
  // A tsconfig with no paths: the hint of the vite config.
  writeFileSync(join(p.dir, 'tsconfig.json'), '{ "include": ["none.d.ts"] }')
  assert.equal(hint('alias.ts'), vite)
  writeFileSync(
    join(p.dir, 'base.json'),
    '{ "compilerOptions": { "paths": { "@lib/*": ["./lib/*"], "@x": ["./x.ts"] } } }',
  )
  writeFileSync(join(p.dir, 'tsconfig.json'), '{ "extends": "./base.json", "include": ["none.d.ts"] }')
  assert.equal(
    hint('alias.ts'),
    `  hint: tsconfig.json has "paths" for "@lib/*". The type checker reads "paths", and the runtime does not. ${fix}`,
  )
})

test('a file that calls process.exit while it loads shows what it wrote', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  writeFileSync(
    join(p.dir, 'stale.ts'),
    "import { assert, test } from 'ubqtest'\nconsole.error('The build is old: build again.')\nprocess.exit(1)\ntest('never', () => assert(true))\n",
  )
  const block = [
    'ERROR stale.ts',
    '  process.exit(1) was called before the tests ended',
    '  output:',
    '  | The build is old: build again.',
  ]
  // In the process of the runner, and in a child process.
  assert.deepEqual(p.ubq('stale.ts').out.split('\n').slice(0, 4), block)
  assert.deepEqual(p.ubq('stale.ts', 'pass.ts').out.split('\n').slice(0, 4), block)
})

test('with coverage that is not complete, ubq uncovered does not say only "none"', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  writeFileSync(join(p.dir, 'src/one.ts'), 'export const one = (): number => 1\n')
  writeFileSync(
    join(p.dir, 'one.test.ts'),
    "import { assert, test } from 'ubqtest'\nimport { one } from './src/one.ts'\ntest('one', () => assert.equal(one(), 1))\n",
  )
  assert.equal(p.ubq('one.test.ts').last, 'pass: 1 test')
  assert.equal(p.ubq('uncovered', 'src/one.ts').out.split('\n')[0], 'uncovered: none')
  // As a plain program, the file has no counters in the files that
  // loaded before the library.
  assert.equal(spawnSync('node', ['one.test.ts'], { cwd: p.dir, encoding: 'utf8' }).status, 0)
  assert.deepEqual(p.ubq('uncovered', 'src/one.ts').out.split('\n').slice(0, 2), [
    'uncovered: none in the coverage of the store, which is not complete',
    'note: coverage is not complete for 1 test file: one.test.ts (partial). Code can be missing from this list. For full coverage, run the file with ubq: ubq <test file>',
  ])
})

test('a skip that the test decides, and an assertion that is in no test', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  writeFileSync(
    join(p.dir, 'skips.ts'),
    `import { assert, cleanup, test } from 'ubqtest'
// An assertion that passes at the top level does nothing more.
assert.equal(1, 1)
const seen: string[] = []
cleanup(() => assert.deepEqual(seen, ['a', 'b']))
test('skips while it runs', ({ skip }) => {
  seen.push('a')
  if (seen.length) skip('nothing to measure')
  assert.equal(1, 2)
})
test('fails then skips', ({ skip }) => {
  try {
    assert.equal(1, 2)
  } catch {}
  skip('too late')
})
test('no reason', ({ skip }) => (skip as () => never)())
test('passes', () => assert(true))
`,
  )
  writeFileSync(
    join(p.dir, 'top.ts'),
    "import { assert, test } from 'ubqtest'\nassert.equal(1, 2, 'at the top level')\ntest('never', () => assert(true))\n",
  )
  writeFileSync(
    join(p.dir, 'snap.ts'),
    "import { assert, test } from 'ubqtest'\nassert.snapshot(1)\ntest('never', () => assert(true))\n",
  )
  assert.deepEqual(p.ubq('skips.ts').out.split('\n'), [
    'FAIL skips.ts > fails then skips',
    '  expected values to be equal',
    '  at skips.ts:13:12',
    '  > assert.equal(1, 2)',
    '  actual:   1',
    '  expected: 2',
    '  rerun: ubq skips.ts:11',
    '',
    'FAIL skips.ts > no reason',
    '  TypeError: skip() needs the reason, as text',
    '  at skips.ts:17:54',
    "  > test('no reason', ({ skip }) => (skip as () => never)())",
    '  rerun: ubq skips.ts:17',
    '',
    // The failure of the file has the values of the assertion.
    'ERROR skips.ts',
    '  a cleanup function failed: expected values to be deeply equal',
    '  at skips.ts:5:22',
    "  > cleanup(() => assert.deepEqual(seen, ['a', 'b']))",
    '  .length',
    '    actual:   1',
    '    expected: 2',
    '  [1]',
    '    actual:   (missing)',
    "    expected: 'b'",
    '',
    'skip skips.ts > skips while it runs: nothing to measure',
    'fail: 1 error, 2 failed, 1 passed, 1 skipped (run 1: ubq failures 1)',
    '',
  ])
  // In a child process too.
  const lines = p.ubq('top.ts', 'snap.ts').out.split('\n')
  assert.deepEqual(lines.slice(lines.indexOf('ERROR top.ts'), lines.indexOf('ERROR top.ts') + 6), [
    'ERROR top.ts',
    '  at the top level: expected values to be equal',
    '  at top.ts:2:8',
    "  > assert.equal(1, 2, 'at the top level')",
    '  actual:   1',
    '  expected: 2',
  ])
  assert.equal(
    lines[lines.indexOf('ERROR snap.ts') + 1],
    '  Error: assert.snapshot was called outside a test. A snapshot has the name of its test.',
  )
})
