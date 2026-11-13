// Tests of a Cloudflare Worker, in workerd (D48).
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assert, cleanup, test } from 'ubqtest'
import { fixtures, remove } from './setup.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const cli = join(root, 'src/cli.ts')

/** A copy of the fixture Worker, with ubqtest and wrangler as packages. */
const project = () => {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'ubq-workers-')))
  cleanup(() => remove(dir))
  cpSync(`${fixtures}workers`, dir, { recursive: true })
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ type: 'module', ubq: { workers: [{ config: 'wrangler.jsonc', include: ['test/**/*.test.ts'] }] } }),
  )
  mkdirSync(join(dir, 'node_modules'))
  symlinkSync(root, join(dir, 'node_modules/ubqtest'), 'junction')
  symlinkSync(join(root, 'node_modules/wrangler'), join(dir, 'node_modules/wrangler'), 'junction')
  const ubq = (...args: string[]) => {
    const r = spawnSync('node', [cli, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, CI: '' } })
    return { code: r.status, out: r.stdout.replace(/ \(run \d+\)\n$/, '').split('\n'), err: r.stderr }
  }
  return { dir, ubq }
}

// The first start of workerd on a machine takes seconds.
const slow = { timeout: 120_000 }

test('a Worker with D1, a Durable Object, and a scheduled handler', slow, () => {
  const p = project()
  assert.deepEqual(p.ubq(), { code: 0, out: ['pass: 0 failed, 6 passed'], err: '' })
  // Coverage of each test, from the source of the Worker.
  assert.deepEqual(p.ubq('uncovered').out.slice(0, 2), [
    "src/index.ts:28:32  return new Response('this line has no test')",
    '1 uncovered ranges in 2 files',
  ])
  assert.deepEqual(p.ubq('covers', 'src/text.ts:1').out.slice(0, 2), [
    'test/worker.test.ts > fetch > a greeting from a var',
    'test/worker.test.ts (while the file loads)',
  ])
  assert.deepEqual(p.ubq('test/worker.test.ts:38').out, ['pass: 0 failed, 1 passed, 5 not selected'])
})

test('failures in workerd have the place in the source, and the output of the test', slow, () => {
  const p = project()
  writeFileSync(
    join(p.dir, 'test/bad.test.ts'),
    `import { assert, test, testdir } from 'ubqtest'
import { shout } from '../src/text'

test('a wrong value', () => {
  console.log('some output')
  assert.equal(shout('a'), 'a!')
})
test('too slow', { timeout: 100 }, async () => {
  await new Promise(done => setTimeout(done, 5000))
})
test('testdir', () => {
  testdir()
})
`,
  )
  assert.deepEqual(p.ubq('test/bad.test.ts'), {
    code: 1,
    out: [
      'FAIL test/bad.test.ts > a wrong value',
      '  expected values to be equal',
      '  at test/bad.test.ts:6:10',
      "  > assert.equal(shout('a'), 'a!')",
      "  actual:   'A!'",
      "  expected: 'a!'",
      '  output:',
      '  | some output',
      '  rerun: ubq test/bad.test.ts:4',
      '',
      'FAIL test/bad.test.ts > too slow',
      '  the test did not end in 100 ms',
      '  at test/bad.test.ts:8:1',
      "  > test('too slow', { timeout: 100 }, async () => {",
      '  rerun: ubq test/bad.test.ts:8',
      '',
      'FAIL test/bad.test.ts > testdir',
      '  Error: testdir does not work in the Workers runtime',
      '  at test/bad.test.ts:12:3',
      '  > testdir()',
      '  rerun: ubq test/bad.test.ts:11',
      '',
      'fail: 3 failed, 0 passed',
    ],
    err: '',
  })
})

test('a test that blocks the thread of workerd, and a source file with an error', slow, () => {
  const p = project()
  writeFileSync(
    join(p.dir, 'test/stuck.test.ts'),
    "import { assert, test } from 'ubqtest'\ntest('a loop', { timeout: 200 }, () => {\n  for (;;) assert(true)\n})\n",
  )
  assert.deepEqual(p.ubq('test/stuck.test.ts').out.slice(0, 2), [
    'FAIL test/stuck.test.ts > a loop',
    '  the test did not end in 200 ms, and the process does not respond. The code is in a loop that does not return.',
  ])
  writeFileSync(join(p.dir, 'src/text.ts'), 'export const shout = (\n')
  assert.deepEqual(p.ubq('test/worker.test.ts').out.slice(0, 2), [
    'ERROR test/worker.test.ts',
    '  the test file did not load: Expression expected',
  ])
})
