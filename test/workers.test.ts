// Tests of a Cloudflare Worker, in workerd (D48).
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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
    '1 uncovered ranges in 1 of the 2 files that tests ran',
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
  // The test file throws after its first test.
  writeFileSync(join(p.dir, 'test/throws.test.ts'), "import { test } from 'ubqtest'\ntest('t', () => {})\nthrow new Error('at load')\n")
  const throws = p.ubq('test/throws.test.ts')
  assert.deepEqual([throws.code, throws.out[0], throws.out.includes('  Error: at load')], [1, 'ERROR test/throws.test.ts', true])
  // A value that is not an error, with no stack.
  writeFileSync(join(p.dir, 'test/throws.test.ts'), "import { test } from 'ubqtest'\ntest('t', () => {})\nthrow 'a string'\n")
  const text = p.ubq('test/throws.test.ts')
  assert.deepEqual([text.code, text.out[0], text.out.some(line => line.includes('a string'))], [1, 'ERROR test/throws.test.ts', true])
  writeFileSync(join(p.dir, 'src/text.ts'), 'export const shout = (\n')
  assert.deepEqual(p.ubq('test/worker.test.ts').out.slice(0, 2), [
    'ERROR test/worker.test.ts',
    '  the test file did not load: Expression expected',
  ])
})

test('test values for vars, a service that is absent, an alias, and a CommonJS package', slow, () => {
  const p = project()
  // A config with a container. No container starts in a test run.
  writeFileSync(join(p.dir, 'Dockerfile'), 'FROM scratch\n')
  writeFileSync(
    join(p.dir, 'wrangler.jsonc'),
    readFileSync(join(p.dir, 'wrangler.jsonc'), 'utf8').replace(
      '"migrations": [',
      '"containers": [{ "class_name": "Counter", "image": "./Dockerfile", "max_instances": 1 }],\n  "migrations": [',
    ),
  )
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
  // No binding of ubq.
  assert.deepEqual(Object.keys(env).sort(), ['COUNTER', 'DB', 'EXTRA', 'GREETING', 'MODE', 'OTHER'])
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

test('modules in workerd: each form of a package, and files that are not code', slow, () => {
  const p = project()
  const dep = (name: string, files: Record<string, string>): void => {
    for (const [file, text] of Object.entries(files)) {
      const path = join(p.dir, 'node_modules', name, file)
      mkdirSync(join(path, '..'), { recursive: true })
      writeFileSync(path, text)
    }
  }
  // `exports` with conditions, a list, and patterns.
  dep('conditions', {
    'package.json': JSON.stringify({
      type: 'module',
      exports: {
        '.': { workerd: './workerd.js', default: './default.js' },
        './list': [{ node: './node.js' }, './list.js'],
        './features/*': './features/*.js',
        './deep/*.js': { import: './deep/*.mjs' },
        './none': [{ node: './node.js' }],
      },
    }),
    'workerd.js': "export const which = 'workerd'\n",
    'default.js': "export const which = 'default'\n",
    'list.js': "export const list = 'list'\n",
    'features/one.js': "export const feature = 'one'\n",
    'deep/two.mjs': "export const deep = 'two'\n",
  })
  // `exports` as one path, to a TypeScript file.
  dep('typed', { 'package.json': '{ "type": "module", "exports": "./index.ts" }', 'index.ts': "export const typed = (n: number): number => n + 1\n" })
  // No `exports`: `module` for an import, `main` for a require, and a path in the package.
  dep('fields', {
    'package.json': '{ "module": "./esm.js", "main": "./cjs.js" }',
    'esm.js': "export const field = 'module'\n",
    'cjs.js': "exports.field = 'main'\n",
    'lib/part.js': "exports.part = 'part'\n",
  })
  // No fields: `index.js`. It gives the exports of a second file, and names that are not names of JavaScript.
  dep('plain', {
    'package.json': '{}',
    'index.js': "module.exports = require('./impl.js')\n",
    'impl.js': "exports.plain = require('fields').field\nexports['not-a-name'] = 1\nexports.class = 2\nexports.default = 3\n",
  })
  // The exports of a file of a second package, and a module with no names.
  dep('again', { 'package.json': '{}', 'index.js': "module.exports = require('plain/impl.js')\n", 'five.js': 'module.exports = 5\n' })
  writeFileSync(join(p.dir, 'test/data.json'), '{ "n": 1 }')
  writeFileSync(join(p.dir, 'test/query.sql'), 'select 1')
  writeFileSync(join(p.dir, 'test/old.cjs'), "exports.old = 'cjs'\n")
  writeFileSync(join(p.dir, 'test/typed.cts'), "exports.typed = (n: number): number => n * 2\n")
  writeFileSync(join(p.dir, 'test/view.jsx'), 'export const View = () => <b>x</b>\n')
  writeFileSync(
    join(p.dir, 'test/modules.test.ts'),
    `import { which } from 'conditions'
import { list } from 'conditions/list'
import { feature } from 'conditions/features/one'
import { deep } from 'conditions/deep/two.js'
import { typed } from 'typed'
import { field } from 'fields'
import { part } from 'fields/lib/part'
import whole, { plain } from 'plain'
import { plain as again } from 'again'
import five from 'again/five.js'
import { assert, test } from 'ubqtest'
import data from './data.json'
import { old } from './old.cjs'
import { typed as twice } from './typed.cts'
import query from './query.sql'

test('packages', () => {
  assert.deepEqual([which, list, feature, deep, typed(1), field, part, plain], ['workerd', 'list', 'one', 'two', 2, 'module', 'part', 'main'])
  // The names of a CommonJS file that are not names of JavaScript are on the default export.
  assert.deepEqual([whole['not-a-name'], whole.class, whole.default], [1, 2, 3])
  assert.deepEqual([again, five, twice(2)], ['main', 5, 4])
})
test('files that are not code', () => {
  assert.deepEqual([data, query, old], [{ n: 1 }, 'select 1', 'cjs'])
})
test('a JSX file, and a file that is not there', async () => {
  await assert.rejects(import('./view.jsx'), /ubq cannot run a JSX file in the Workers runtime/)
  await assert.rejects(import('./no-such-file.js'), /No such module/)
  await assert.rejects(import('no-such-package'), /No such module/)
  // No entry of the list has the conditions of workerd.
  await assert.rejects(import('conditions/none'), /No such module/)
})
`,
  )
  assert.deepEqual(p.ubq('test/modules.test.ts'), { code: 0, out: ['pass: 0 failed, 3 passed'], err: '' })
})

test('a wrangler config with few keys, and errors of the setup', slow, () => {
  const p = project()
  const config = (value: unknown): void => writeFileSync(join(p.dir, 'small.jsonc'), JSON.stringify(value))
  const configure = (): void =>
    writeFileSync(join(p.dir, 'package.json'), JSON.stringify({ type: 'module', ubq: { workers: [{ config: 'small.jsonc', include: ['small/*.test.ts'] }] } }))
  configure()
  mkdirSync(join(p.dir, 'small'))
  mkdirSync(join(p.dir, 'node_modules/pkg'))
  writeFileSync(join(p.dir, 'node_modules/pkg/package.json'), '{ "type": "module", "exports": "./index.js" }')
  writeFileSync(join(p.dir, 'node_modules/pkg/index.js'), "export const pkg = 'pkg'\n")
  writeFileSync(
    join(p.dir, 'small/small.test.ts'),
    `import { env } from 'cloudflare:workers'
import { pkg } from 'other-name'
import { assert, test } from 'ubqtest'
import { migrate } from 'ubqtest/workers'

const e = env as unknown as { SELF: { fetch(url: string): Promise<Response> } }
test('a config with no name, no main, and no vars', async () => {
  assert.equal(pkg, 'pkg')
  // A D1 database with no folder of migrations.
  await migrate('DB')
  await assert.rejects(migrate('NOPE'), /no D1 database with the binding "NOPE"/)
  // A service binding to this Worker is not replaced.
  assert.equal(typeof e.SELF.fetch, 'function')
})
`,
  )
  // No name, no main, no vars. An alias to a package. A service binding to the Worker itself.
  config({
    compatibility_date: '2026-07-01',
    alias: { 'other-name': 'pkg' },
    d1_databases: [
      { binding: 'DB', database_name: 'd', database_id: '00000000-0000-0000-0000-000000000000' },
      { binding: 'DB2', database_name: 'd2', database_id: '00000000-0000-0000-0000-000000000001', migrations_dir: 'none' },
    ],
    services: [{ binding: 'SELF', service: 'ubq' }],
  })
  assert.deepEqual(p.ubq('small/small.test.ts'), { code: 0, out: ['pass: 0 failed, 1 passed'], err: '' })

  // The main module of the Worker throws a value that is not an error.
  writeFileSync(join(p.dir, 'small/main.ts'), "throw 'not an error'\n")
  config({ compatibility_date: '2026-07-01', main: 'small/main.ts', alias: { 'other-name': 'pkg' } })
  assert.deepEqual(p.ubq('small/small.test.ts').out.slice(0, 2), ['ERROR small/small.test.ts', '  the test file did not load: not an error'])

  // A config that wrangler refuses.
  config({ compatibility_date: 1 })
  assert.match(p.ubq('small/small.test.ts').out[1]!, /^  the test file did not load: wrangler cannot read small\.jsonc\. /)

  // A project with no wrangler.
  // The link is a junction on Windows, which is a folder: `rmSync` of Node 24.11 does not remove it.
  const link = join(p.dir, 'node_modules/wrangler')
  if (process.platform === 'win32') rmdirSync(link)
  else rmSync(link)
  assert.deepEqual(p.ubq('small/small.test.ts').out.slice(0, 2), [
    'ERROR small/small.test.ts',
    '  the test file did not load: this test file runs in the Workers runtime, and the project does not have wrangler. Run: npm install --save-dev wrangler',
  ])
})

test('the helpers of ubqtest/workers work only in the Workers runtime', async () => {
  const { executionContext } = await import('ubqtest/workers')
  assert.throws(() => executionContext(), {
    message:
      'executionContext works only in a test file that runs in the Workers runtime. Add the file to "workers" in the "ubq" key of package.json.',
  })
})
