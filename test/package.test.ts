// The package that `npm run build` makes works in a project that
// installs it: as a plain program on each runtime, through the
// `ubq` command, and for the type checker.
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { assert, cleanup, test } from 'ubqtest'
import { addJsx, project, remove } from './setup.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'ubq-package-')))
cleanup(() => rmSync(dir, { recursive: true }))
const pkg = join(dir, 'node_modules/ubqtest')
const build = spawnSync('node', ['scripts/build.ts', pkg], { cwd: root, encoding: 'utf8' })

const files: Record<string, string> = {
  'package.json': '{ "type": "module" }',
  'tsconfig.json': JSON.stringify({
    compilerOptions: {
      module: 'nodenext',
      target: 'esnext',
      strict: true,
      noEmit: true,
      allowImportingTsExtensions: true,
      erasableSyntaxOnly: true,
      types: ['node'],
    },
    include: ['src', 'test'],
  }),
  'src/add.ts': `import { sep } from 'node:path'
export const add = (a: number, b: number): number => a + b
export const separator = (): string => sep
export const never = (): number => 0
`,
  'test/add.test.ts': `import { assert, mockImport, test } from 'ubqtest'
import { add } from '../src/add.ts'

test('adds', () => {
  assert.equal(add(1, 2), 3)
})

test('a mock', async () => {
  const mocked = await mockImport(() => import('../src/add.ts'), [
    [() => import('node:path'), { sep: '/' }],
  ])
  assert.equal(mocked.separator(), '/')
})
`,
  'test/bad.ts': `import { test } from 'ubqtest'
test.only('x', () => {})
`,
}
for (const [name, text] of Object.entries(files)) {
  mkdirSync(join(dir, name, '..'), { recursive: true })
  writeFileSync(join(dir, name), text)
}
symlinkSync(join(root, 'node_modules/@types'), join(dir, 'node_modules/@types'), 'junction')

const sh = (cmd: string, ...args: string[]) => {
  const r = spawnSync(cmd, args, { cwd: dir, encoding: 'utf8' })
  return { code: r.status, err: r.stderr, lines: r.stdout.replace(/ \(run \d+\)\n$/, '').trimEnd().split('\n') }
}
const has = (cmd: string): string | false =>
  spawnSync(cmd, ['--version']).status !== 0 && `${cmd} is not installed`

test('the build has no errors, and the package has no dependencies', async () => {
  assert.equal(build.stderr, '')
  assert.equal(build.status, 0)
  const { default: manifest } = await import(pathToFileURL(join(pkg, 'package.json')).href, { with: { type: 'json' } })
  // The packages that a project can add: the driver of
  // `ubqtest/browser`, and the tool of `ubqtest/workers`.
  assert.deepEqual(Object.keys(manifest).filter(key => /dependencies/i.test(key)), ['peerDependencies', 'peerDependenciesMeta'])
  assert.deepEqual([manifest.peerDependencies, manifest.peerDependenciesMeta], [
    { 'playwright-core': '>=1.49', wrangler: '>=4' },
    { 'playwright-core': { optional: true }, wrangler: { optional: true } },
  ])
})

for (const [cmd, ...args] of [['node'], ['deno', 'run', '-A'], ['bun']] as const)
  test(`a test file is a plain program on ${cmd}`, { skip: has(cmd) }, () => {
    const r = sh(cmd, ...args, 'test/add.test.ts')
    assert.deepEqual([r.lines, r.err], [['pass: 0 failed, 2 passed'], ''])
  })

for (const [cmd, ...args] of [['node'], ['deno', 'run', '-A'], ['bun']] as const)
  test(`the ubq command on ${cmd}, with coverage`, { skip: has(cmd) }, () => {
    const ubq = join(pkg, 'cli.js')
    assert.deepEqual(sh(cmd, ...args, ubq).lines, ['pass: 0 failed, 2 passed'])
    assert.deepEqual(sh(cmd, ...args, ubq, 'uncovered').lines, [
      'src/add.ts:4:22  (): number => 0',
      '1 uncovered ranges in 1 files',
    ])
  })

for (const [cmd, ...args] of [['node'], ['deno', 'run', '-A'], ['bun']] as const)
  test(`the tests of a Worker in workerd, with the ubq command on ${cmd}`, { skip: has(cmd), timeout: 120_000 }, () => {
    const worker = realpathSync.native(mkdtempSync(join(tmpdir(), 'ubq-package-workers-')))
    cleanup(() => remove(worker))
    cpSync(join(root, 'test/fixtures/workers'), worker, { recursive: true })
    writeFileSync(
      join(worker, 'package.json'),
      JSON.stringify({ type: 'module', ubq: { workers: [{ config: 'wrangler.jsonc', include: ['test/**/*.test.ts'] }] } }),
    )
    mkdirSync(join(worker, 'node_modules'))
    symlinkSync(pkg, join(worker, 'node_modules/ubqtest'), 'junction')
    symlinkSync(join(root, 'node_modules/wrangler'), join(worker, 'node_modules/wrangler'), 'junction')
    const run = (...more: string[]) => {
      const r = spawnSync(cmd, [...args, join(pkg, 'cli.js'), ...more], { cwd: worker, encoding: 'utf8', env: { ...process.env, CI: '' } })
      return [r.stdout.replace(/ \(run \d+\)\n$/, '').trimEnd().split('\n'), r.stderr]
    }
    assert.deepEqual(run(), [['pass: 0 failed, 6 passed'], ''])
    assert.deepEqual(run('uncovered'), [["src/index.ts:28:32  return new Response('this line has no test')", '1 uncovered ranges in 2 files'], ''])
  })

test('docs/api.md is current', () => {
  const r = spawnSync('node', ['scripts/api-docs.ts', '--check', join(pkg, 'types')], { cwd: root, encoding: 'utf8' })
  assert.deepEqual([r.status, r.stderr], [0, ''])
})

test('the guide and the doctor of the package', () => {
  const ubq = join(pkg, 'cli.js')
  assert.equal(sh('node', ubq, 'guide').lines[0], '# ubq guide')
  assert.equal(sh('node', ubq, 'doctor').lines.at(-1), 'doctor: 0 problems')
})

test('the runner on deno gives the same output as on node', { skip: has('deno'), timeout: 30_000 }, async () => {
  // The fixture project, with the built package in place of the source.
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  for (const f of ['busy.ts', 'hang.ts', 'output.ts']) cpSync(join(root, 'test/fixtures', f), join(p.dir, f))
  // The link to the source. On Windows it is a junction, which is a
  // folder: Node 24.11 does not remove it with `rmSync`.
  if (process.platform === 'win32') rmdirSync(join(p.dir, 'node_modules/ubqtest'))
  else rmSync(join(p.dir, 'node_modules/ubqtest'))
  cpSync(pkg, join(p.dir, 'node_modules/ubqtest'), { recursive: true })
  const ubq = join(pkg, 'cli.js')
  const run = (cmd: string[], ...args: string[]): Promise<string[]> =>
    new Promise(done => {
      const child = spawn(cmd[0]!, [...cmd.slice(1), ubq, ...args], { cwd: p.dir, env: { ...process.env, CI: '' } })
      let text = ''
      child.stdout.on('data', data => (text += data))
      child.stderr.on('data', data => (text += data))
      // The run number and the seed change with each run.
      child.on('close', () => {
        const lines = text.split('\n').filter(l => !l.startsWith('file order:')).map(l => l.replace(/ \(run \d+\)$/, ''))
        // Deno has no async tracking for a server, so its hang rerun
        // does not name the line that opened one.
        const server = lines.indexOf('HANG hang.ts > times out with a server open')
        if (server >= 0) lines.splice(server, 4)
        done(lines)
      })
    })
  const deno = ['deno', 'run', '-A']
  // The runs are at the same time: some of them wait for a time limit.
  await Promise.all(
    // On Windows, Node gives no stack for a loop that does not return.
    ['fail.ts', 'mock.ts', 'output.ts', 'hang.ts', ...(process.platform === 'win32' ? [] : ['busy.ts'])].flatMap(file => [
      (async () => assert.deepEqual(await run(deno, file, 'pass.ts'), await run(['node'], file, 'pass.ts'), file))(),
      // One file runs in the process of the runner.
      file !== 'busy.ts' &&
        (async () => assert.deepEqual(await run(deno, file), await run(['node'], file), `${file} alone`))(),
    ]),
  )
  // The hang rerun on Deno names the line that started a timer.
  assert((await run(deno, 'hang.ts')).includes('  Timeout opened at hang.ts:18:32'))
  // Coverage, also of a mocked instance.
  await run(deno, 'mock.ts', 'pass.ts')
  assert.deepEqual(await run(['node'], 'covers', 'src/word.ts:3'), [
    'mock.ts > a mock reaches the modules that the module imports, and builtins',
    'mock.ts > a mock replaces a dependency in a new instance of the module',
    'mock.ts (while the file loads)',
    '2 tests run src/word.ts:3',
    '',
  ])
  assert.deepEqual(await run(['node'], 'uncovered', 'src/shape.ts'), await run(deno, 'uncovered', 'src/shape.ts'))
  // An import of `./two.js` finds `./two.ts`, as on Node.
  writeFileSync(join(p.dir, 'src/one.ts'), "import { two } from './two.js'\nexport const one = (): number => two() - 1\n")
  writeFileSync(join(p.dir, 'src/two.ts'), 'export const two = (): number => 2\n')
  writeFileSync(
    join(p.dir, 'one.ts'),
    "import { assert, test } from 'ubqtest'\nimport { one } from './src/one.js'\ntest('one', () => {\n  assert.equal(one(), 1)\n})\n",
  )
  assert.deepEqual(await run(deno, 'one.ts'), ['pass: 0 failed, 1 passed', ''])
  // Deno compiles JSX before a load hook sees the file. The
  // counters go into its JavaScript, and its source map gives the
  // places in the source.
  addJsx(p.dir)
  assert.deepEqual(await run(deno, 'view.tsx'), ['pass: 0 failed, 3 passed', ''])
  assert.deepEqual(await run(deno, 'uncovered', 'src/view.tsx'), [
    'src/view.tsx:8:37  <b>many',
    'src/view.tsx:17:22  <T,>({ value }: { value: T }) => <i>{String(value',
    '2 uncovered ranges in 1 files',
    '',
  ])
  assert.deepEqual(await run(deno, 'covers', 'src/view.tsx:12'), [
    'view.tsx > a view of no items',
    'view.tsx > a view of two items',
    '2 tests run src/view.tsx:12',
    '',
  ])
  assert.deepEqual(await run(deno, 'mutate', 'src/view.tsx'), [
    'ubq: ubq mutate cannot change src/view.tsx on Deno. Run it on Node or Bun.',
    '',
  ])
})

test('the type declarations of the package', () => {
  const r = sh('node', join(root, 'node_modules/typescript/bin/tsc'), '--pretty', 'false')
  assert.equal(r.lines.length, 2, r.lines.join('\n'))
  assert.match(r.lines[0]!, /^test\/bad\.ts\(2,6\): error TS2349/)
  assert.match(r.lines[1]!, /ubq has no \.only\. Select tests on the command line/)
})
