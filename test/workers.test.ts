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
    JSON.stringify({
      type: 'module',
      ubq: { workers: [{ config: 'wrangler.jsonc', include: ['test/**/*.test.ts'], vars: { MODE: 'test', EXTRA: { a: 1 } } }] },
    }),
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
  // A module that the test file imports cannot do I/O when it loads.
  writeFileSync(join(p.dir, 'test/setup.ts'), "import { migrate } from 'ubqtest/workers'\nawait migrate('DB')\nexport const ready = true\n")
  writeFileSync(
    join(p.dir, 'test/setup.test.ts'),
    "import { assert, test } from 'ubqtest'\nimport { ready } from './setup.ts'\ntest('ready', () => assert(ready))\n",
  )
  assert.deepEqual(p.ubq('test/setup.test.ts').out.slice(0, 4), [
    'ERROR test/setup.test.ts',
    '  the test file did not load: a module did I/O while it loaded (a query, a fetch, a timer, or a random value). workerd permits that only in the test file itself, not in a module that it imports. Put the work in a function that the module exports, and await that function at the top level of the test file.',
    '  at test/setup.ts:2:7',
    "  > await migrate('DB')",
  ])
  writeFileSync(join(p.dir, 'src/text.ts'), 'export const shout = (\n')
  assert.deepEqual(p.ubq('test/worker.test.ts').out.slice(0, 2), [
    'ERROR test/worker.test.ts',
    '  the test file did not load: Expression expected',
  ])
})

test('test values for vars, a service that is absent, an alias, and a CommonJS package', slow, () => {
  const p = project()
  // The file of `wrangler dev` for secrets. A test must not get them.
  writeFileSync(join(p.dir, '.dev.vars'), 'GREETING=secret\nAPI_KEY=real-key\n')
  // An ES module package that imports a name from a CommonJS package.
  const dep = (name: string, files: Record<string, string>): void => {
    mkdirSync(join(p.dir, 'node_modules', name, 'lib'), { recursive: true })
    for (const [file, text] of Object.entries(files)) writeFileSync(join(p.dir, 'node_modules', name, file), text)
  }
  dep('cjs-dep', {
    'package.json': '{ "name": "cjs-dep", "main": "index.js" }',
    'index.js': `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const util_1 = require("./lib/util");
const data = require("./data.json");
class Webhook { sign(text) { return (0, util_1.wrap)(text) + data.mark; } }
exports.Webhook = Webhook;
exports.version = '1';
`,
    'lib/util.js': 'exports.wrap = text => `[${text}]`;\n',
    'data.json': '{ "mark": "!" }',
  })
  dep('esm-dep', {
    'package.json': '{ "name": "esm-dep", "type": "module", "exports": "./index.mjs" }',
    'index.mjs': "import { Webhook } from 'cjs-dep'\nimport whole from 'cjs-dep'\nexport const sign = text => new Webhook().sign(text) + whole.version\n",
  })
  writeFileSync(
    join(p.dir, 'test/env.test.ts'),
    `import { env } from 'cloudflare:workers'
import { aliased } from 'aliased'
import { version } from 'cjs-dep'
import { sign } from 'esm-dep'
import { assert, test } from 'ubqtest'

const e = env as unknown as Record<string, unknown> & { OTHER: { fetch(url: string): Promise<Response> } }
test('vars', () => {
  assert.deepEqual([e.GREETING, e.MODE, e.EXTRA, e.API_KEY], ['hello', 'test', { a: 1 }, undefined])
})
test('a service that is not part of the run', async () => {
  const response = await e.OTHER.fetch('http://x/')
  assert.deepEqual(
    [response.status, await response.text()],
    [503, 'ubq: the service "other-worker" of the binding OTHER is not part of this test run'],
  )
})
test('an alias and packages', () => {
  assert.deepEqual([aliased, sign('a'), version], ['yes', '[a]!1', '1'])
})
`,
  )
  assert.deepEqual(p.ubq('test/env.test.ts'), { code: 0, out: ['pass: 0 failed, 3 passed'], err: '' })
})
