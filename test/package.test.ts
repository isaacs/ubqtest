// The package that `npm run build` makes works in a project that
// installs it: as a plain program on each runtime, through the
// `ubq` command, and for the type checker.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assert, cleanup, test } from 'ubqtest'

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

for (const cmd of ['node', 'bun'])
  test(`the ubq command on ${cmd}, with coverage`, { skip: has(cmd) }, () => {
    const ubq = join(pkg, 'cli.js')
    assert.deepEqual(sh(cmd, ubq).lines, ['pass: 0 failed, 2 passed'])
    assert.deepEqual(sh(cmd, ubq, 'uncovered').lines, [
      'src/add.ts:4:22  (): number => 0',
      '1 uncovered ranges in 1 files',
    ])
  })

test('the type declarations of the package', () => {
  const r = sh(join(root, 'node_modules/.bin/tsc'), '--pretty', 'false')
  assert.equal(r.lines.length, 2, r.lines.join('\n'))
  assert.match(r.lines[0]!, /^test\/bad\.ts\(2,6\): error TS2349/)
  assert.match(r.lines[1]!, /ubq has no \.only\. Select tests on the command line/)
})
