// Wrong uses of the test API, and tests that leave the process in a
// different state. Each one must give a report that says what to do.
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assert, cleanup, env, spy, test } from 'ubqtest'
import { project } from './setup.ts'

const files: Record<string, string> = {
  'name-empty.test.ts': "import { test } from 'ubqtest'\ntest('', () => {})\n",
  'name-sep.test.ts': "import { test } from 'ubqtest'\ntest('a > b', () => {})\n",
  'no-fn.test.ts': "import { test } from 'ubqtest'\n;(test as (name: string) => void)('x')\n",
  'describe-no-fn.test.ts': "import { describe } from 'ubqtest'\n;(describe as (name: string) => void)('g')\n",
  'option.test.ts': "import { test } from 'ubqtest'\ntest('x', { retries: 2 } as object, () => {})\n",
  'describe-option.test.ts':
    "import { describe } from 'ubqtest'\ndescribe('g', { concurrency: 4 } as object, () => {})\n",
  'describe-async.test.ts':
    "import { describe } from 'ubqtest'\ndescribe('g', (async () => {}) as unknown as () => void)\n",
  'inside.test.ts': `import { assert, describe, test } from 'ubqtest'
test('a test in a test', () => {
  test('inner', () => {})
})
test('a group in a test', () => {
  describe('inner', () => {})
})
test('ok', () => assert(true))
`,
  'late.test.ts': `import { assert, cleanup, env, spy, test } from 'ubqtest'
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
  'file-cleanup.test.ts': `import { assert, cleanup, env, spy, test } from 'ubqtest'
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

test('each wrong use of the test API has a report with the cause', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true, force: true }))
  for (const [name, text] of Object.entries(files)) writeFileSync(join(p.dir, name), text)
  const r = p.ubq()
  const blocks = new Set(r.out.split('\n\n'))
  const has = (...lines: string[]): void => assert(blocks.has(lines.join('\n')), lines[0] + '\n' + r.out)
  has(
    'ERROR name-empty.test.ts',
    '  TypeError: test name must be a string that is not empty',
    '  at name-empty.test.ts:2:1',
    "  > test('', () => {})",
  )
  has(
    'ERROR name-sep.test.ts',
    '  TypeError: test name must not contain " > ": "a > b"',
    '  at name-sep.test.ts:2:1',
    "  > test('a > b', () => {})",
  )
  has(
    'ERROR no-fn.test.ts',
    '  TypeError: test "x" has no function',
    '  at no-fn.test.ts:2:34',
    "  > ;(test as (name: string) => void)('x')",
  )
  has(
    'ERROR option.test.ts',
    '  TypeError: test "x" has the option "retries", which ubq does not have. The options are skip and timeout.',
    '  at option.test.ts:2:1',
    "  > test('x', { retries: 2 } as object, () => {})",
  )
  has(
    'ERROR describe-option.test.ts',
    '  TypeError: describe "g" has the option "concurrency", which ubq does not have. The options are skip and timeout. The tests of a file run one at a time.',
    '  at describe-option.test.ts:2:1',
    "  > describe('g', { concurrency: 4 } as object, () => {})",
  )
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
  // A value that is not an error has no stack: the place is that of
  // the test() call.
  has(
    'FAIL misc.test.ts > throws a value that is not an error',
    '  threw text',
    '  at misc.test.ts:6:1',
    "  > test('throws a value that is not an error', () => {",
    '  rerun: ubq misc.test.ts:6',
  )
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
  assert.equal(r.last, 'fail: 9 errors, 7 failed, 6 passed')
})

const asserts = `import { assert, isDeepEqual, isMatch, spy, test } from 'ubqtest'
const bad = (): never => {
  throw new RangeError('out of range')
}
test('throws: a message that does not match', () => {
  assert.throws(bad, /not this/)
})
test('throws: a different class', () => {
  assert.throws(bad, TypeError)
})
test('throws: a pattern that does not match', () => {
  assert.throws(bad, { name: 'TypeError' })
})
test('throws: a value that is not an error', () => {
  assert.throws(() => {
    throw 'text'
  }, /other/)
})
test('throws: the function returns', () => {
  assert.throws(() => 1, Error)
})
test('throws: text as the expected error', () => {
  assert.throws(bad, 'out of range' as unknown as RegExp)
})
test('rejects: a different error', async () => {
  await assert.rejects(Promise.reject(new RangeError('out of range')), TypeError)
})
test('rejects: the promise resolves', async () => {
  await assert.rejects(async () => 1, Error)
})
test('fail', () => {
  assert.fail('this must not happen')
})
test('deepEqual: a difference in a symbol key', () => {
  assert.deepEqual({ [Symbol.for('k')]: 1 }, {})
})
test('assertions after the end of the test', () => {
  setTimeout(() => {
    assert.match('a', /a/)
    assert.snapshot('a')
    void assert.eventually(() => 1, 1)
    assert.equal(1, 2)
  }, 10)
  assert(true)
})
test('waits', async () => {
  await new Promise(done => setTimeout(done, 100))
  assert(true)
})
test('assert: no call of a spy has the arguments', () => {
  const s = spy()
  s('a', 1)
  s('b')
  assert(s.calls.some(call => isDeepEqual(call.args, ['c'])))
})
test('assert: a call of a spy has the arguments', () => {
  const s = spy()
  s('a')
  s('b')
  assert(!s.calls.some(call => isDeepEqual(call.args, ['b'])))
})
test('assert: more calls of isDeepEqual than the report shows', () => {
  assert([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].some(n => isDeepEqual(n, 0)))
})
test('assert: isDeepEqual before a different assertion', () => {
  assert(!isDeepEqual(1, 2))
  assert(false)
})
test('assert: no call of a spy matches the pattern', () => {
  const s = spy()
  s({ id: 7, tags: { port: undefined, long: 'x'.repeat(70) } })
  assert(s.calls.some(call => isMatch(call.args, [{ id: 7, tags: { port: 80 } }])))
})
test('assert: a difference with a long value', () => {
  assert(isDeepEqual({ long: 'x'.repeat(70) }, { long: '' }))
})
test('rejects: a value that is not an Error', async () => {
  await assert.rejects(Promise.reject(Symbol('full')), Error)
})
test('matchOnly: a key that the pattern does not have', () => {
  assert.matchOnly({ id: 1, user: { name: 'ann', age: 3 } }, { id: 1, user: { name: /^a/ } })
})
`

test('each kind of failed assertion has a report with the two values and the place', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true, force: true }))
  writeFileSync(join(p.dir, 'asserts.test.ts'), asserts)
  writeFileSync(
    join(p.dir, 'outside.test.ts'),
    "import { assert, test } from 'ubqtest'\nassert.equal(1, 2)\ntest('a', () => assert(true))\n",
  )
  const r = p.ubq()
  const blocks = new Set(r.out.split('\n\n'))
  const has = (...lines: string[]): void => assert(blocks.has(lines.join('\n')), lines[0] + '\n' + r.out)
  const fail = (name: string, line: number, ...lines: string[]): void =>
    has(`FAIL asserts.test.ts > ${name}`, ...lines, `  rerun: ubq asserts.test.ts:${line}`)
  has(
    // An assertion that is in no test fails the file, with its values.
    'ERROR outside.test.ts',
    '  expected values to be equal',
    '  at outside.test.ts:2:8',
    '  > assert.equal(1, 2)',
    '  actual:   1',
    '  expected: 2',
  )
  fail(
    'throws: a message that does not match',
    5,
    '  the function threw a different error',
    '  at asserts.test.ts:6:10',
    '  > assert.throws(bad, /not this/)',
    '  actual:   RangeError: out of range',
    '  expected: an error with a message that matches /not this/',
  )
  fail(
    'throws: a different class',
    8,
    '  the function threw a different error',
    '  at asserts.test.ts:9:10',
    '  > assert.throws(bad, TypeError)',
    '  actual:   RangeError: out of range',
    '  expected: an instance of TypeError',
  )
  fail(
    'throws: a pattern that does not match',
    11,
    '  the function threw a different error',
    '  at asserts.test.ts:12:10',
    "  > assert.throws(bad, { name: 'TypeError' })",
    '  .name',
    "    actual:   'RangeError'",
    "    expected: 'TypeError'",
  )
  fail(
    'throws: a value that is not an error',
    14,
    '  the function threw a different error',
    '  at asserts.test.ts:15:10',
    '  > assert.throws(() => {',
    "  actual:   'text'",
    '  expected: an error with a message that matches /other/',
  )
  fail(
    'throws: the function returns',
    19,
    '  expected the function to throw, but it returned',
    '  at asserts.test.ts:20:10',
    '  > assert.throws(() => 1, Error)',
  )
  fail(
    'throws: text as the expected error',
    22,
    '  TypeError: assert.throws needs the expected error as its second argument: a RegExp for the message, an error class, or an object pattern',
    '  at asserts.test.ts:23:10',
    "  > assert.throws(bad, 'out of range' as unknown as RegExp)",
  )
  // The check runs after an await. The place is that of the call.
  fail(
    'rejects: a different error',
    25,
    '  the promise rejected with a different error',
    '  at asserts.test.ts:26:16',
    "  > await assert.rejects(Promise.reject(new RangeError('out of range')), TypeError)",
    '  actual:   RangeError: out of range',
    '  expected: an instance of TypeError',
  )
  fail(
    'rejects: the promise resolves',
    28,
    '  expected the promise to reject, but it resolved',
    '  at asserts.test.ts:29:16',
    '  > await assert.rejects(async () => 1, Error)',
  )
  fail('fail', 31, '  this must not happen', '  at asserts.test.ts:32:10', "  > assert.fail('this must not happen')")
  fail(
    'deepEqual: a difference in a symbol key',
    34,
    '  expected values to be deeply equal',
    '  at asserts.test.ts:35:10',
    "  > assert.deepEqual({ [Symbol.for('k')]: 1 }, {})",
    // Node 22 shows a symbol key in brackets.
    `  actual:   ${+process.versions.node.split('.')[0]! < 24 ? '{ [Symbol(k)]: 1 }' : '{ Symbol(k): 1 }'}`,
    '  expected: {}',
  )
  // One report for the first assertion after the end of the test.
  fail(
    'assertions after the end of the test',
    37,
    '  an assertion ran after the test ended. Await all async work in the test.',
    '  at asserts.test.ts:39:12',
    "  > assert.match('a', /a/)",
  )
  // The values of the isDeepEqual calls of a failed assert(value).
  fail(
    'assert: no call of a spy has the arguments',
    50,
    '  expected a truthy value, got false',
    '  at asserts.test.ts:54:3',
    "  > assert(s.calls.some(call => isDeepEqual(call.args, ['c'])))",
    '  isDeepEqual call 1 gave false',
    "    actual:   [ 'a', 1 ]",
    "    expected: [ 'c' ]",
    '    note: the first difference is at .length: actual 2, expected 1',
    '  isDeepEqual call 2 gave false',
    "    actual:   [ 'b' ]",
    "    expected: [ 'c' ]",
    "    note: the first difference is at [0]: actual 'b', expected 'c'",
  )
  fail(
    'assert: a call of a spy has the arguments',
    56,
    '  expected a truthy value, got false',
    '  at asserts.test.ts:60:3',
    "  > assert(!s.calls.some(call => isDeepEqual(call.args, ['b'])))",
    '  isDeepEqual call 1 gave false',
    "    actual:   [ 'a' ]",
    "    expected: [ 'b' ]",
    "    note: the first difference is at [0]: actual 'a', expected 'b'",
    '  isDeepEqual call 2 gave true',
    "    actual:   [ 'b' ]",
    "    expected: [ 'b' ]",
  )
  assert.match(r.out, /  isDeepEqual call 8 gave false\n    actual:   8\n    expected: 0\n  … and 2 more differences\n/)
  // Only the calls after the last assertion.
  fail(
    'assert: isDeepEqual before a different assertion',
    65,
    '  expected a truthy value, got false',
    '  at asserts.test.ts:67:3',
    '  > assert(false)',
  )
  // isMatch has the same report, with the place of the first difference.
  const long = `'${'x'.repeat(70)}'`
  fail(
    'assert: no call of a spy matches the pattern',
    69,
    '  expected a truthy value, got false',
    '  at asserts.test.ts:72:3',
    '  > assert(s.calls.some(call => isMatch(call.args, [{ id: 7, tags: { port: 80 } }])))',
    '  isMatch call 1 gave false',
    '    actual:   [',
    '                {',
    '                  id: 7,',
    '                  tags: {',
    `                    long: ${long},`,
    '                    port: undefined',
    '                  }',
    '                }',
    '              ]',
    '    expected: [ { id: 7, tags: { port: 80 } } ]',
    '    note: the first difference is at [0].tags.port: actual undefined, expected 80',
  )
  // A value that is too long for one line is not in the note.
  assert.match(r.out, /    note: the first difference is at \.long\n/)
  // The form for a value that is not an Error.
  fail(
    'rejects: a value that is not an Error',
    77,
    '  the promise rejected with a different error',
    '  at asserts.test.ts:78:16',
    "  > await assert.rejects(Promise.reject(Symbol('full')), Error)",
    '  actual:   Symbol(full)',
    '  expected: an instance of Error',
    '  note: the value is not an Error instance. For such a value, use a RegExp: it tests String(value). The assertion returns the value.',
  )
  fail(
    'matchOnly: a key that the pattern does not have',
    80,
    '  expected value to match the pattern, with no other keys',
    '  at asserts.test.ts:81:10',
    "  > assert.matchOnly({ id: 1, user: { name: 'ann', age: 3 } }, { id: 1, user: { name: /^a/ } })",
    '  .user.age',
    '    actual:   3',
    '    expected: (missing)',
  )
  assert.equal(r.last, 'fail: 1 error, 19 failed, 1 passed')
})

test('a snapshot file that cannot be written, two open timers, and a changed variable', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true, force: true }))
  // A file where the folder of the snapshots must be.
  writeFileSync(join(p.dir, 'ubq-snapshots'), '')
  const snap = p.ubq('--update', 'snap.ts')
  assert.deepEqual([snap.code, snap.out.split('\n')[0]], [1, 'ERROR snap.ts'])
  assert.match(snap.out, /^  Error: EEXIST: /m)
  writeFileSync(
    join(p.dir, 'open.test.ts'),
    `import { assert, test } from 'ubqtest'
test('two timers', () => {
  setInterval(() => {}, 1000)
  setInterval(() => {}, 1000)
  assert(true)
})
test('changes a variable', () => {
  process.env.HOME = 'changed'
  assert(true)
})
`,
  )
  const open = p.ubq('open.test.ts', 'pass.ts').out
  assert.match(open, /^  the test changed the environment variable HOME and did not put it back\./m)
  assert.match(open, /^  still open: Timeout x2$/m)
})

// Outside a test.
const outside = import('ubqtest/browser').then(m => m.browser()).catch((error: Error) => error.message)

test('wrong arguments to spy and cleanup, and browser() outside a test', async () => {
  assert.throws(() => spy(1 as never), { name: 'TypeError', message: 'spy() needs a function, or no argument' })
  assert.throws(() => cleanup(1 as never), { name: 'TypeError', message: 'cleanup() needs a function' })
  assert.equal(await outside, 'browser() must run in a test, before the test ends. Await the call.')
})

test('a "ubq" key that is not an object, and snapshots of many lines', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true, force: true }))
  p.configure(1)
  assert.deepEqual([p.ubq().code, p.ubq().err], [4, 'ubq: "ubq" in package.json must be an object\n'])
  p.configure()
  writeFileSync(
    join(p.dir, 'snaps.test.ts'),
    "import { assert, test } from 'ubqtest'\ntest('lines', () => assert.snapshot(process.env.SNAP_LINES ?? 'a\\nb\\nc\\nd\\ne\\nf'))\n",
  )
  assert.equal(p.ubq('--update', 'snaps.test.ts').code, 0)
  // Four differences, and a count of the others.
  env({ SNAP_LINES: '1\n2\n3\n4\n5\n6\n7' })
  assert.match(
    p.ubq('snaps.test.ts').out,
    /\n  line 4\n    actual:   "4"\n    expected: "d"\n  … and 3 more differences\n/,
  )
  // A line that only one of the two values has.
  env({ SNAP_LINES: 'a\nb\nc' })
  assert.match(p.ubq('snaps.test.ts').out, /\n  line 4\n    actual:   \(no line\)\n    expected: "d"\n/)
  env({ SNAP_LINES: 'a\nb\nc\nd\ne\nf\ng' })
  assert.match(p.ubq('snaps.test.ts').out, /\n  line 7\n    actual:   "g"\n    expected: \(no line\)\n/)
  // A file with no snapshots left loses its snapshot file.
  writeFileSync(
    join(p.dir, 'snaps.test.ts'),
    "import { assert, test } from 'ubqtest'\ntest('lines', () => assert(true))\n",
  )
  assert.equal(p.ubq('--update', 'snaps.test.ts').code, 0)
  assert.equal(existsSync(join(p.dir, 'ubq-snapshots/snaps.test.ts.snap')), false)
})

test('a failure that is only keys with the value undefined has a hint', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true, force: true }))
  writeFileSync(
    join(p.dir, 'keys.test.ts'),
    `import { any, assert, test } from 'ubqtest'
const value: Record<string, unknown> = { id: 1, needs: undefined }
test('deep', () => assert.deepEqual(value, { id: 1 }))
test('only', () => assert.matchOnly(value, { id: any.number }))
// Other differences, and an element of an array: no hint.
test('other', () => assert.deepEqual(value, { id: 2 }))
test('array', () => assert.deepEqual([undefined], []))
`,
  )
  const hint =
    'hint: each difference is a key with the value undefined that the expected value does not have. toEqual of vitest and jest passes for such a key, and ubq does not. Remove the key from the value, or add it to the expected value with the value undefined.'
  const blocks = p.ubq('keys.test.ts').out.split('\n\n')
  const of = (name: string): string => blocks.find(b => b.startsWith(`FAIL keys.test.ts > ${name}\n`)) ?? ''
  assert.contains(of('deep'), `  expected values to be deeply equal\n  ${hint}\n`)
  assert.contains(of('only'), `  expected value to match the pattern, with no other keys\n  ${hint}\n`)
  assert.notContains(of('other'), 'hint:')
  assert.notContains(of('array'), 'hint:')
  assert.contains(of('array'), 'expected values to be deeply equal')
})
