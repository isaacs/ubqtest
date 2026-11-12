// The package that `npm run build` makes works in a project that
// installs it: as a plain program on each runtime, through the
// `ubq` command, and for the type checker.
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assert, cleanup, test } from 'ubqtest'
import { project } from './setup.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const dir = mkdtempSync(join(tmpdir(), 'ubq-package-'))
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
symlinkSync(join(root, 'node_modules/@types'), join(dir, 'node_modules/@types'))

const sh = (cmd: string, ...args: string[]) => {
  const r = spawnSync(cmd, args, { cwd: dir, encoding: 'utf8' })
  return { code: r.status, err: r.stderr, lines: r.stdout.replace(/ \(run \d+\)\n$/, '').trimEnd().split('\n') }
}
const has = (cmd: string): string | false =>
  spawnSync(cmd, ['--version']).status !== 0 && `${cmd} is not installed`

test('the build has no errors, and the package has no dependencies', async () => {
  assert.equal(build.stderr, '')
  assert.equal(build.status, 0)
  const { default: manifest } = await import(join(pkg, 'package.json'), { with: { type: 'json' } })
  assert.deepEqual(Object.keys(manifest).filter(key => /dependencies/i.test(key)), [])
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
  rmSync(join(p.dir, 'node_modules/ubqtest'))
  cpSync(pkg, join(p.dir, 'node_modules/ubqtest'), { recursive: true })
  const ubq = join(pkg, 'cli.js')
  const run = (cmd: string[], ...args: string[]): Promise<string[]> =>
    new Promise(done => {
      const child = spawn(cmd[0]!, [...cmd.slice(1), ubq, ...args], { cwd: p.dir, env: { ...process.env, CI: '' } })
      let text = ''
      child.stdout.on('data', data => (text += data))
      child.stderr.on('data', data => (text += data))
      // The run number and the seed change with each run.
      child.on('close', () =>
        done(text.split('\n').filter(l => !l.startsWith('file order:')).map(l => l.replace(/ \(run \d+\)$/, ''))),
      )
    })
  const deno = ['deno', 'run', '-A']
  // The runs are at the same time: some of them wait for a time limit.
  await Promise.all(
    ['fail.ts', 'mock.ts', 'output.ts', 'hang.ts', 'busy.ts'].flatMap(file => [
      (async () => assert.deepEqual(await run(deno, file, 'pass.ts'), await run(['node'], file, 'pass.ts'), file))(),
      // One file runs in the process of the runner.
      file !== 'busy.ts' &&
        (async () => assert.deepEqual(await run(deno, file), await run(['node'], file), `${file} alone`))(),
    ]),
  )
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
})

test('the type declarations of the package', () => {
  const r = sh(join(root, 'node_modules/.bin/tsc'), '--pretty', 'false')
  assert.equal(r.lines.length, 2, r.lines.join('\n'))
  assert.match(r.lines[0]!, /^test\/bad\.ts\(2,6\): error TS2349/)
  assert.match(r.lines[1]!, /ubq has no \.only\. Select tests on the command line/)
})
