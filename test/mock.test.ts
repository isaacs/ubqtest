// Wrong uses of mockImport, a mock with a default export, and a
// module under test that throws when it loads.
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assert, cleanup, mockImport, test } from 'ubqtest'
import { scanImports } from '../src/mock.ts'
import { cli, project, remove } from './setup.ts'

const bun = spawnSync('bun', ['--version']).status === 0

const SHAPE = "must be an arrow function of the form () => import('...')"

test('a mock loader of the wrong form', async () => {
  const subject = () => import('./fixtures/src/greet.ts')
  await assert.rejects(mockImport(subject, [['./fixtures/src/db.ts' as never, {}]]), {
    name: 'TypeError',
    message: `a mock loader ${SHAPE}`,
  })
  await assert.rejects(mockImport(subject, [[() => import('./fixtures/src/db.ts'), null as never]]), {
    name: 'TypeError',
    message: 'the second item of a mock must be an object with the exports that replace the module',
  })
  await assert.rejects(mockImport(subject, [[() => Promise.resolve({}) as never, {}]]), {
    name: 'TypeError',
    message: `a mock loader ${SHAPE}`,
  })
})

test('a mock with a default export', async () => {
  const mocked = await mockImport(
    () => import('./fixtures/src/greet.ts'),
    [[() => import('./fixtures/src/word.ts'), { default: 'unused', word: () => 'hey' } as never]],
  )
  assert.equal(await mocked.greet(7), 'hey user 7')
})

test('two mockImport calls share one list of mocks, which is readonly', async () => {
  const mocks = [
    [() => import('./fixtures/src/db.ts'), { fetchUser: async (id: number) => ({ id, name: 'ann' }), table: 't' }],
  ] as const
  const one = await mockImport(() => import('./fixtures/src/greet.ts'), mocks)
  const two = await mockImport(() => import('./fixtures/src/greet.ts'), mocks)
  assert.match(await one.greet(1), / ann$/)
  assert.notEqual(one.greet, two.greet)
})

test('the error of a module under test that throws when it loads', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ubq-mock-'))
  cleanup(() => rmSync(dir, { recursive: true, force: true }))
  writeFileSync(join(dir, 'throws.mjs'), "throw new Error('at load')\n")
  const url = pathToFileURL(join(dir, 'throws.mjs')).href
  await assert.rejects(
    mockImport(() => import(url), []),
    { message: 'at load' },
  )
})

test('an import in the new instance that names no file: the place is the import', () => {
  const p = project()
  cleanup(() => remove(p.dir))
  writeFileSync(
    join(p.dir, 'src/missing.ts'),
    "import { fetchUser } from './db.ts'\nimport './nope.ts'\nexport const x = fetchUser\n",
  )
  writeFileSync(
    join(p.dir, 'lost.test.ts'),
    `import { assert, mockImport, test } from 'ubqtest'
test('lost', async () => {
  assert(await mockImport(() => import('./src/missing.ts'), [[() => import('./src/db.ts'), {}]]))
})
`,
  )
  assert.deepEqual(p.ubq('lost.test.ts').out.split('\n').slice(0, 5), [
    'FAIL lost.test.ts > lost',
    "  Error: Cannot find module 'src/nope.ts' imported from src/missing.ts",
    '  at src/missing.ts:2:11',
    "  > import './nope.ts'",
    '  rerun: ubq lost.test.ts:2',
  ])
})

test('a new instance that imports ubqtest gets the library of the test, also with a link to the package', () => {
  const p = project()
  cleanup(() => remove(p.dir))
  // A second copy of the library would report the failure again.
  writeFileSync(
    join(p.dir, 'src/checks.ts'),
    "import { assert } from 'ubqtest'\nimport { fetchUser } from './db.ts'\nexport const check = (): void => assert.equal(fetchUser, undefined)\n",
  )
  writeFileSync(
    join(p.dir, 'check.test.ts'),
    `import { mockImport, test } from 'ubqtest'
test('check', async () => {
  const { check } = await mockImport(() => import('./src/checks.ts'), [
    [() => import('./src/db.ts'), { fetchUser: (() => 'x') as never }],
  ])
  check()
})
`,
  )
  const r = p.ubq('check.test.ts')
  assert.deepEqual(
    [r.out.split('\n').filter(line => line.startsWith('FAIL ')).length, r.out.split('\n')[1], r.last],
    [1, '  expected values to be equal', 'fail: 1 failed, 0 passed'],
  )
})

test('a mock that no import of the instance gets, and the form for a dependency of a package', () => {
  const p = project()
  cleanup(() => remove(p.dir))
  mkdirSync(join(p.dir, 'node_modules/reader'))
  writeFileSync(
    join(p.dir, 'node_modules/reader/package.json'),
    '{ "name": "reader", "type": "module", "main": "index.js" }',
  )
  // The package imports the module of the runtime, and the project does not.
  writeFileSync(
    join(p.dir, 'node_modules/reader/index.js'),
    "import { existsSync } from 'node:fs'\nexport const has = path => existsSync(path)\n",
  )
  writeFileSync(
    join(p.dir, 'src/find.ts'),
    "import { has } from 'reader'\nexport const find = (): boolean => has('/no/such/file')\n",
  )
  writeFileSync(
    join(p.dir, 'unused.ts'),
    `import { assert, mockImport, test } from 'ubqtest'
const fs = { existsSync: () => true }
test('the mock does not get to the package', async () => {
  const { find } = await mockImport(() => import('./src/find.ts'), [[() => import('fs'), fs as never]])
  assert.equal(find(), false)
})
test('a failure of the test gets the cause', async () => {
  const { find } = await mockImport(() => import('./src/find.ts'), [[() => import('node:fs'), fs as never]])
  assert.equal(find(), true)
})
test('two mocks of project files that the instance does not import', async () => {
  await mockImport(() => import('./src/find.ts'), [
    [() => import('./pass.ts'), {}],
    [() => import('./fix.ts'), {}],
  ])
  assert(true)
})
test('an instance of the package with the mock, as the mock of the package', async () => {
  const reader = await mockImport(() => import('reader'), [[() => import('node:fs'), fs as never]])
  const { find } = await mockImport(() => import('./src/find.ts'), [[() => import('reader'), reader]])
  assert.equal(find(), true)
})
`,
  )
  const hint =
    'the mock of node:fs replaced no import. No project module of the new instance imports it. A mock does not go into a package of node_modules: if a package imports the module, make an instance of the package with the mock, and give that instance as the mock of the package. See "A dependency of a dependency" in ubq guide mock.'
  const blocks = p.ubq('unused.ts').out.split('\n\n')
  assert.deepEqual(
    blocks.map(block => block.split('\n').slice(0, 2)),
    [
      // 'fs' and 'node:fs' are one module.
      ['FAIL unused.ts > the mock does not get to the package', `  a cleanup function failed: Error: ${hint}`],
      ['FAIL unused.ts > a failure of the test gets the cause', '  expected values to be equal'],
      [
        'FAIL unused.ts > two mocks of project files that the instance does not import',
        '  a cleanup function failed: Error: the mock of pass.ts, fix.ts replaced no import. No project module of the new instance imports them. A mock does not go into a package of node_modules: if a package imports the module, make an instance of the package with the mock, and give that instance as the mock of the package. See "A dependency of a dependency" in ubq guide mock.',
      ],
      ['fail: 3 failed, 1 passed (run 1: ubq failures 1)', ''],
    ],
  )
  assert(blocks[1]!.includes(`\n  hint: ${hint}\n`), blocks[1])
  // Bun gives the URL of a mock that no import got as a path. The
  // message has the path from the root of the project.
  if (bun) {
    const r = spawnSync('bun', [cli, 'unused.ts'], { cwd: p.dir, encoding: 'utf8' })
    assert.match(r.stdout, /the mock of pass\.ts, fix\.ts replaced no import/)
  }
})

test('scanImports gives the names that a file uses from each module', () => {
  const found = scanImports(`import a, { b, c as d, type T, type as e } from './one.ts'
import * as all from './two.ts'
import type { U } from './types.ts'
import { type V } from './inline.ts'
import './effect.ts'
export { f as g } from './three.ts'
export * from './four.ts'
export const later = () => import('./five.ts')
const old = require('./six.cjs')
const x = 1; export const y = x
`)
  assert.deepEqual(
    found.map(i => [i.specifier, i.names === '*' ? '*' : [...i.names].sort().join(',')]),
    [
      ['./one.ts', 'b,c,default,type'],
      ['./two.ts', '*'],
      // The import stays with no names: it loads the module.
      ['./inline.ts', ''],
      ['./three.ts', 'f'],
      ['./four.ts', '*'],
      ['./effect.ts', ''],
      ['./five.ts', '*'],
      ['./six.cjs', '*'],
    ],
  )
})

/** Source for the tests of a partial mock, of the modules that stay, and of a mock that changes. */
const PARTIAL: Record<string, string> = {
  'src/state.ts': 'export let n = 0\nexport const bump = (): number => ++n\nexport class Thing {}\n',
  'src/bad.ts': "throw new Error('the real module loaded')\nexport const value = 0\n",
  'src/dep.ts':
    "export const a = (): string => 'real a'\nexport const b = (): string => 'real b'\nexport default { a, b }\n",
  'src/mid.ts': "import { a } from './dep.ts'\nexport const viaMid = (): string => a()\n",
  'src/subject.ts': `import { bump, Thing } from './state.ts'
import { a, b } from './dep.ts'
import { viaMid } from './mid.ts'
import { value } from './bad.ts'
export const run = (): unknown[] => [a(), b(), viaMid(), value, bump()]
export const make = (): Thing => new Thing()
`,
  'src/whole.ts': `import d from './dep.ts'
import * as all from './dep.ts'
export const run = (): string[] => [d.a(), d.b(), all.a(), all.b()]
`,
  'src/counts.ts': "import { bump } from './state.ts'\nexport const next = (): number => bump()\n",
  'src/object.ts': "import s from './state.ts'\nexport const next = (): number => s.bump()\n",
  'partial.test.ts': `import { assert, mockImport, spy, spyOn, stub, test } from 'ubqtest'
import * as state from './src/state.ts'

// One instance for the file. The mock of dep.ts has one of its two
// exports. The mock of bad.ts has each export that the code uses,
// so the real module, which throws, does not load.
const dep = { a: spy(() => 'mock a') }
const bad = { value: 1 }
const subject = await mockImport(() => import('./src/subject.ts'), [
  [() => import('./src/dep.ts'), dep],
  [() => import('./src/bad.ts'), bad],
])

test('an export that the mock does not have is the real one, also in a module between', () => {
  assert.deepEqual(subject.run(), ['mock a', 'real b', 'mock a', 1, 1])
})

test('a module that imports no mock is the module of the test file', () => {
  assert.equal(state.n, 1)
  assert(subject.make() instanceof state.Thing)
})

test('spyOn and stub on the mock object change the instance for one test', () => {
  const other = spyOn(dep, 'a', () => 'other a')
  stub(bad, 'value', 2)
  assert.deepEqual(subject.run().slice(0, 4), ['other a', 'real b', 'other a', 2])
  assert.equal(other.calls.length, 2)
})

test('the old values are back in the next test', () => {
  assert.deepEqual(subject.run().slice(0, 4), ['mock a', 'real b', 'mock a', 1])
})

test('a default import and a namespace import of a partial mock', async () => {
  const whole = await mockImport(() => import('./src/whole.ts'), [[() => import('./src/dep.ts'), dep]])
  assert.deepEqual(whole.run(), ['mock a', 'real b', 'mock a', 'real b'])
  // The real module has no default export: the mock object is the default.
  const object = await mockImport(() => import('./src/object.ts'), [[() => import('./src/state.ts'), { bump: () => 7 }]])
  assert.equal(object.next(), 7)
})

test('an empty mock gives a new instance of a module', async () => {
  const before = state.n
  const counts = await mockImport(() => import('./src/counts.ts'), [[() => import('./src/state.ts'), {}]])
  assert.equal(counts.next(), 1)
  assert.equal(state.n, before)
  // With no mock, the module under test is new, and state.ts is not.
  const shared = await mockImport(() => import('./src/counts.ts'), [])
  assert.equal(shared.next(), before + 1)
})
`,
}

test('a partial mock, modules that stay, and a mock that changes in a test, on Node and on Bun', () => {
  const p = project()
  cleanup(() => remove(p.dir))
  for (const [file, source] of Object.entries(PARTIAL)) writeFileSync(join(p.dir, file), source)
  const r = p.ubq('partial.test.ts')
  assert.equal(r.out, 'pass: 6 tests (run 1)\n', r.out)
  if (bun) {
    const onBun = spawnSync('bun', [cli, 'partial.test.ts'], { cwd: p.dir, encoding: 'utf8' })
    assert.equal(onBun.stdout, 'pass: 6 tests (run 2)\n', onBun.stdout + onBun.stderr)
  }
})
