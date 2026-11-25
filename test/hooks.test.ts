// The hooks: beforeEach, afterEach, beforeAll, afterAll.
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assert, beforeEach, cleanup, test } from 'ubqtest'
import { project } from './setup.ts'

// A hook of this file. Its function returns a value, which is not a type error.
let started = 0
beforeEach(() => (started += 1))

const HEAD = `import { appendFileSync } from 'node:fs'
import { afterAll, afterEach, assert, beforeAll, beforeEach, cleanup, describe, test, testdir } from 'ubqtest'
const log = (text: string) => appendFileSync('log.txt', text + '\\n')
`

/** A project with one test file. `run` gives the output, and the lines that the file logged. */
const fixture = (source: string) => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  writeFileSync(join(p.dir, 'hooks.test.ts'), HEAD + source)
  return (...args: string[]) => {
    rmSync(join(p.dir, 'log.txt'), { force: true })
    const { out } = p.ubq(...(args.length ? args : ['hooks.test.ts']))
    let log: string[] = []
    try {
      log = readFileSync(join(p.dir, 'log.txt'), 'utf8').trim().split('\n')
    } catch {
      // No hook and no test wrote a line.
    }
    return { out, log }
  }
}

const ORDER = `beforeAll(() => {
  log('file beforeAll')
  cleanup(() => log('file cleanup'))
})
afterAll(() => log('file afterAll'))
beforeEach(() => log('file beforeEach'))
afterEach(() => log('file afterEach 1'))
afterEach(() => log('file afterEach 2'))
test('a', () => {
  log('a')
  assert(true)
})
describe('g', () => {
  beforeAll(() => {
    log('g beforeAll ' + testdir().split('/').pop())
    cleanup(() => log('g cleanup'))
  })
  afterAll(() => log('g afterAll'))
  test('b', () => {
    log('b')
    assert(true)
  })
  // A hook after a test of its group is a hook of that test too.
  beforeEach(({ signal }) => {
    log('g beforeEach ' + signal.aborted)
    cleanup(() => log('test cleanup'))
  })
  afterEach(() => log('g afterEach'))
  test('c', { skip: 'not now' }, () => {})
  describe('all skipped', () => {
    beforeAll(() => log('never'))
    afterAll(() => log('never'))
    test('s', { skip: 'not now' }, () => {})
  })
})
test('d', () => {
  log('d')
  assert(true)
})
`

test('the hooks run in the order of jest and vitest, and a group starts at its first test that runs', () => {
  const run = fixture(ORDER)
  const { out, log } = run()
  assert.contains(out, 'pass: 3 tests, 2 skipped')
  assert.deepEqual(log, [
    'file beforeAll',
    'file beforeEach',
    'a',
    'file afterEach 2',
    'file afterEach 1',
    'g beforeAll _group-g',
    'file beforeEach',
    'g beforeEach false',
    'b',
    'g afterEach',
    'file afterEach 2',
    'file afterEach 1',
    'test cleanup',
    'g afterAll',
    'g cleanup',
    'file beforeEach',
    'd',
    'file afterEach 2',
    'file afterEach 1',
    'file afterAll',
    'file cleanup',
  ])
  // A selection of one test runs only the hooks of its groups.
  assert.deepEqual(run('hooks.test.ts > a').log, [
    'file beforeAll',
    'file beforeEach',
    'a',
    'file afterEach 2',
    'file afterEach 1',
    'file afterAll',
    'file cleanup',
  ])
})

test('a failure in a hook: the test fails for beforeEach and afterEach, the group for beforeAll, the file for afterAll', () => {
  const run = fixture(`describe('each', () => {
  beforeEach(() => {
    throw new Error('no setup')
  })
  afterEach(() => log('afterEach ran'))
  test('a', () => {
    log('not run')
    assert(true)
  })
})
describe('after', () => {
  afterEach(() => {
    assert.equal(1, 2, 'the check after')
  })
  test('b', () => {
    assert(true)
  })
})
describe('all', () => {
  beforeAll(async () => {
    cleanup(() => log('cleanup of all'))
    await Promise.reject(new Error('no server'))
  })
  describe('inner', () => {
    beforeAll(() => log('not run'))
    test('c', () => {
      log('not run')
    })
  })
  test('d', () => {})
  afterAll(() => {
    throw new Error('no stop')
  })
})
describe('after throws', () => {
  afterEach(() => {
    throw new Error('no close')
  })
  test('f', () => {
    assert(true)
  })
})
describe('slow', { timeout: 50 }, () => {
  beforeAll(() => new Promise(() => setTimeout(() => {}, 1000)))
  test('e', () => {})
})
`)
  const { out, log } = run()
  assert.deepEqual(log, ['afterEach ran', 'cleanup of all'])
  assert.contains(out, 'FAIL hooks.test.ts > each > a\n  Error: no setup\n  at hooks.test.ts:6:11')
  // An assertion in a hook fails the test as an assertion in the test does.
  assert.contains(
    out,
    'FAIL hooks.test.ts > after > b\n  the check after: expected values to be equal\n  at hooks.test.ts:16:12',
  )
  for (const id of ['all > inner > c', 'all > d'])
    assert.contains(out, `FAIL hooks.test.ts > ${id}\n  beforeAll of the group all failed: Error: no server`)
  assert.contains(out, 'ERROR hooks.test.ts\n  afterAll of the group all failed: Error: no stop')
  assert.contains(out, 'FAIL hooks.test.ts > slow > e\n  beforeAll of the group slow did not end in 50 ms')
  assert.contains(out, 'FAIL hooks.test.ts > after throws > f\n  afterEach failed: Error: no close')
  assert.contains(out, 'fail: 1 error, 6 failed')
  assert.greaterThan(started, 0)
})

test('an assertion in a hook is no assertion of the test, and skip() in a beforeEach skips the test', () => {
  const run = fixture(`describe('checks', () => {
  beforeEach(() => assert(true))
  afterEach(() => assert(true))
  test('a', () => {})
})
describe('skips', () => {
  beforeEach(({ skip }) => skip('no network'))
  afterEach(() => log('afterEach ran'))
  test('b', () => {
    log('not run')
  })
})
`)
  const { out, log } = run()
  assert.contains(out, 'FAIL hooks.test.ts > checks > a\n  the test ran no assertions')
  assert.contains(out, 'fail: 1 failed, 0 passed, 1 skipped')
  assert.deepEqual(log, ['afterEach ran'])
})

test('a hook call at a wrong place, or with a wrong argument, is an error that names the fix', () => {
  const run = fixture(`test('a', () => {
  beforeEach(() => {})
})
describe('g', () => {
  beforeAll(() => {
    afterAll(() => {})
  })
  test('b', () => {})
})
`)
  const { out } = run()
  assert.contains(
    out,
    'FAIL hooks.test.ts > a\n  Error: beforeEach() was called inside a running test or hook. Call it at the top level of the file, or in the function of describe().',
  )
  assert.contains(out, 'beforeAll of the group g failed: Error: afterAll() was called inside a running test or hook.')
  const args = fixture(`// @ts-expect-error: a hook takes one argument
beforeAll(() => {}, 10_000)
test('a', () => {})
`)
  assert.contains(args().out, 'TypeError: beforeAll() takes one argument, the function.')
  const none = fixture(`// @ts-expect-error: a hook needs a function
afterEach()
test('a', () => {})
`)
  assert.contains(none().out, 'TypeError: afterEach() needs a function')
})
