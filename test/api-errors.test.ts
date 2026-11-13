// Wrong uses of the test API, and tests that leave the process in a
// different state. Each one must give a report that says what to do.
import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assert, cleanup, test } from 'ubqtest'
import { project } from './setup.ts'

const files: Record<string, string> = {
  'name-empty.test.ts': "import { test } from 'ubqtest'\ntest('', () => {})\n",
  'name-sep.test.ts': "import { test } from 'ubqtest'\ntest('a > b', () => {})\n",
  'no-fn.test.ts': "import { test } from 'ubqtest'\n;(test as (name: string) => void)('x')\n",
  'describe-no-fn.test.ts': "import { describe } from 'ubqtest'\n;(describe as (name: string) => void)('g')\n",
  'describe-async.test.ts': "import { describe } from 'ubqtest'\ndescribe('g', (async () => {}) as unknown as () => void)\n",
  'inside.test.ts': `import { assert, describe, test } from 'ubqtest'
test('a test in a test', () => {
  test('inner', () => {})
})
test('a group in a test', () => {
  describe('inner', () => {})
})
test('ok', () => assert(true))
`,
  'late.test.ts': `import { assert, cleanup, test } from 'ubqtest'
cleanup(() => {})
test('first', () => assert(true))
await new Promise(done => setTimeout(done, 100))
test('second', () => assert(true))
`,
  'misc.test.ts': `import { assert, cleanup, describe, test } from 'ubqtest'
process.env.UBQ_TEST_VALUE = '1'
describe('group with options', { timeout: 1000 }, () => {
  test('gets the limit of its group', () => assert(true))
})
test('throws a value that is not an error', () => {
  throw 'text'
})
test('a cleanup function with an assertion that fails', () => {
  cleanup(() => assert.equal(1, 2))
  assert(true)
})
test('a cleanup function that does not end', { timeout: 50 }, () => {
  cleanup(() => new Promise(() => {}))
  assert(true)
})
test('removes an environment variable', () => {
  delete process.env.UBQ_TEST_VALUE
  assert(true)
})
test('the signal of the test', async ({ signal }) => {
  assert(signal instanceof AbortSignal)
})
`,
  'file-cleanup.test.ts': `import { assert, cleanup, test } from 'ubqtest'
cleanup(() => {
  throw new Error('the cleanup of the file')
})
test('a', () => assert(true))
`,
  'stray.test.ts': `import { assert, test } from 'ubqtest'
test('two errors after its end', () => {
  setTimeout(() => {
    throw new Error('late 1')
  }, 10)
  setTimeout(() => {
    throw new Error('late 2')
  }, 30)
  assert(true)
})
test('waits', async () => {
  await new Promise(done => setTimeout(done, 100))
  assert(true)
})
`,
}

test('each wrong use of the test API has a report with the cause', { timeout: 60_000 }, () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true, force: true }))
  for (const [name, text] of Object.entries(files)) writeFileSync(join(p.dir, name), text)
  const r = p.ubq()
  const blocks = new Set(r.out.split('\n\n'))
  const has = (...lines: string[]): void => assert(blocks.has(lines.join('\n')), lines[0] + '\n' + r.out)
  has('ERROR name-empty.test.ts', '  TypeError: test name must be a string that is not empty', '  at name-empty.test.ts:2:1', "  > test('', () => {})")
  has('ERROR name-sep.test.ts', '  TypeError: test name must not contain " > ": "a > b"', '  at name-sep.test.ts:2:1', "  > test('a > b', () => {})")
  has('ERROR no-fn.test.ts', '  TypeError: test "x" has no function', '  at no-fn.test.ts:2:34', "  > ;(test as (name: string) => void)('x')")
  has(
    'ERROR describe-no-fn.test.ts',
    '  TypeError: describe "g" has no function',
    '  at describe-no-fn.test.ts:2:38',
    "  > ;(describe as (name: string) => void)('g')",
  )
  has(
    'ERROR describe-async.test.ts',
    '  TypeError: the function of describe "g" must not be async. Await at the top level of the file, before describe().',
    '  at describe-async.test.ts:2:1',
    "  > describe('g', (async () => {}) as unknown as () => void)",
  )
  has(
    'FAIL inside.test.ts > a test in a test',
    '  Error: test() was called inside a running test. Put each test at the top level or in describe().',
    '  at inside.test.ts:3:3',
    "  > test('inner', () => {})",
    '  rerun: ubq inside.test.ts:2',
  )
  has(
    'FAIL inside.test.ts > a group in a test',
    '  Error: describe() was called inside a running test.',
    '  at inside.test.ts:6:3',
    "  > describe('inner', () => {})",
    '  rerun: ubq inside.test.ts:5',
  )
  has(
    'ERROR late.test.ts',
    '  Error: test() was called after the cleanup functions of the file ran. Call test() with no await between the first call and the last call.',
    '  at late.test.ts:5:1',
    "  > test('second', () => assert(true))",
  )
  has('FAIL misc.test.ts > throws a value that is not an error', '  threw text', '  rerun: ubq misc.test.ts:6')
  has(
    'FAIL misc.test.ts > a cleanup function with an assertion that fails',
    '  expected values to be equal',
    '  at misc.test.ts:10:24',
    '  > cleanup(() => assert.equal(1, 2))',
    '  actual:   1',
    '  expected: 2',
    '  rerun: ubq misc.test.ts:9',
  )
  // The process stays alive for the time limit of the cleanup function.
  has(
    'FAIL misc.test.ts > a cleanup function that does not end',
    '  a cleanup function did not end in 50 ms',
    '  at misc.test.ts:13:1',
    "  > test('a cleanup function that does not end', { timeout: 50 }, () => {",
    '  rerun: ubq misc.test.ts:13',
  )
  has(
    'FAIL misc.test.ts > removes an environment variable',
    '  the test changed the environment variable UBQ_TEST_VALUE and did not put it back. Use env({ UBQ_TEST_VALUE: value }): it puts the old value back when the test ends.',
    '  at misc.test.ts:17:1',
    "  > test('removes an environment variable', () => {",
    '  rerun: ubq misc.test.ts:17',
  )
  has(
    'ERROR file-cleanup.test.ts',
    '  a cleanup function failed: Error: the cleanup of the file',
    '  at file-cleanup.test.ts:3:9',
    "  > throw new Error('the cleanup of the file')",
  )
  // The second error after the end of the test is not a second report.
  has(
    'FAIL stray.test.ts > two errors after its end',
    '  after the test ended: Error: late 1',
    '  at stray.test.ts:4:11',
    "  > throw new Error('late 1')",
    '  rerun: ubq stray.test.ts:2',
  )
  assert(!r.out.includes('late 2'))
  assert.equal(r.last, 'fail: 12 errors, 7 failed, 6 passed')
})
