// Wrong uses of mockImport, a mock with a default export, and a
// module under test that throws when it loads.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { assert, cleanup, mockImport, test } from 'ubqtest'

const SHAPE = "must be an arrow function of the form () => import('...')"

test('a mock loader of the wrong form', async () => {
  const subject = () => import('./fixtures/src/greet.ts')
  await assert.rejects(
    mockImport(subject, [['./fixtures/src/db.ts' as never, {}]]),
    { name: 'TypeError', message: `a mock loader ${SHAPE}` },
  )
  await assert.rejects(
    mockImport(subject, [[() => import('./fixtures/src/db.ts'), null as never]]),
    { name: 'TypeError', message: 'the second item of a mock must be an object with the exports that replace the module' },
  )
  await assert.rejects(
    mockImport(subject, [[() => Promise.resolve({}) as never, {}]]),
    { name: 'TypeError', message: `a mock loader ${SHAPE}` },
  )
})

test('a mock with a default export', async () => {
  const mocked = await mockImport(() => import('./fixtures/src/greet.ts'), [
    [() => import('./fixtures/src/word.ts'), { default: 'unused', word: () => 'hey' } as never],
  ])
  assert.equal(await mocked.greet(7), 'hey user 7')
})

test('the error of a module under test that throws when it loads', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ubq-mock-'))
  cleanup(() => rmSync(dir, { recursive: true, force: true }))
  writeFileSync(join(dir, 'throws.mjs'), "throw new Error('at load')\n")
  const url = pathToFileURL(join(dir, 'throws.mjs')).href
  await assert.rejects(mockImport(() => import(url), []), { message: 'at load' })
})
