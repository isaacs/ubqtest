// Wrong uses of mockImport, a mock with a default export, and a
// module under test that throws when it loads.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assert, cleanup, mockImport, test } from 'ubqtest'
import { project, remove } from './setup.ts'

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
