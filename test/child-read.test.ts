// The reader of the counts that child processes write: files that
// it cannot use.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assert, cleanup, test } from 'ubqtest'
import type { Children } from '../src/child-read.ts'

// The library loaded its copy before coverage started. This copy
// has coverage.
const { CHILDREN, readChildren }: typeof import('../src/child-read.ts') = await import('../src/child-read.ts?copy' as string)

test('a child file that is not JSON, a cache entry that is not there, and counts of a different file', () => {
  const root = mkdtempSync(join(tmpdir(), 'ubq-child-read-'))
  cleanup(() => rmSync(root, { recursive: true, force: true }))
  const dir = join(root, 'children')
  mkdirSync(dir)
  mkdirSync(join(root, '.ubq/counters'), { recursive: true })
  const region = { start: 0, end: 10, fn: true, parent: -1 }
  // The source of the map is not there.
  writeFileSync(
    join(root, '.ubq/counters/child-read-two.json'),
    JSON.stringify({ regions: [region, region], sources: [{ file: 'gone.ts', hash: 'x' }] }),
  )
  writeFileSync(join(dir, 'bad.json'), '{')
  writeFileSync(join(dir, 'notes.txt'), '')
  writeFileSync(
    join(dir, '1.json'),
    JSON.stringify({
      files: {
        'a.ts': { cache: 'child-read-missing.json', counts: [1] },
        'b.ts': { cache: 'child-read-two.json', counts: [1, 1, 1] },
      },
    }),
  )
  // This process reads its own children with the same key.
  const shared = globalThis as { [CHILDREN]?: Children }
  const own = shared[CHILDREN]
  cleanup(() => void (shared[CHILDREN] = own))
  shared[CHILDREN] = { dir, root }
  assert.deepEqual(readChildren(), [])
  // A folder that is not there.
  shared[CHILDREN] = { dir: join(root, 'none'), root }
  assert.deepEqual(readChildren(), [])
})
