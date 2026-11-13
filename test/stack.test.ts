// The places of a stack trace.
import { fileURLToPath } from 'node:url'
import { assert, test } from 'ubqtest'

// The library loaded its copy before coverage started. This copy
// has coverage.
const { userFrames }: typeof import('../src/stack.ts') = await import('../src/stack.ts?copy' as string)

test('a frame with no column is at column 1', () => {
  const path = fileURLToPath(new URL('../a.ts', import.meta.url))
  assert.deepEqual(userFrames(`Error: x\n    at ${path}:5\n    at ${path}:6:7`), [
    { file: 'a.ts', line: 5, column: 1 },
    { file: 'a.ts', line: 6, column: 7 },
  ])
})
