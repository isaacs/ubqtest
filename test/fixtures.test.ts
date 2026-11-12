// Fixtures, spies, and module mocks: cleanup, env, testdir, spy,
// spyOn, mockImport.
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { assert, cleanup, env, mockImport, spy, spyOn, test, testdir } from 'ubqtest'
import { project } from './setup.ts'

test('fixtures end with their test, and a failed test keeps its testdir', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  // fix.ts checks that a variable has its old value after a test.
  env({ FIX_B: 'b' })
  const r = p.ubq('fix.ts')
  assert.equal(r.err, '')
  assert.deepEqual(r.out.replace(/ \(run \d+\)\n$/, '').split('\n'), [
    'FAIL fix.ts > a failure keeps the folder',
    '  expected values to be equal',
    '  at fix.ts:34:10',
    '  > assert.equal(1 as number, 2)',
    '  actual:   1',
    '  expected: 2',
    '  testdir: .ubq/testdir/fix.ts/a-failure-keeps-the-folder',
    '  rerun: ubq fix.ts:32',
    '',
    'FAIL fix.ts > a cleanup that throws',
    '  a cleanup function failed: Error: bad cleanup',
    '  at fix.ts:43:11',
    "  > throw new Error('bad cleanup')",
    '  rerun: ubq fix.ts:41',
    '',
    'FAIL fix.ts > a cleanup after the end',
    '  after the test ended: Error: cleanup() was called after its test ended. Call it before the test function returns, or await the code that calls it.',
    '  at fix.ts:50:20',
    '  > setTimeout(() => cleanup(() => {}), 5)',
    '  rerun: ubq fix.ts:49',
    '',
    'fail: 3 failed, 4 passed',
  ])
  // Only the folder of the failed test stays.
  const dirs = join(p.dir, '.ubq/testdir/fix.ts')
  assert.deepEqual(readdirSync(dirs), ['a-failure-keeps-the-folder'])
  assert.equal(readFileSync(join(dirs, 'a-failure-keeps-the-folder/kept.txt'), 'utf8'), 'kept')
  // Stored results name the folder while it exists.
  const show = p.ubq('show', 'fix.ts > a failure keeps the folder').out
  assert.match(show, /\n  testdir: \.ubq\/testdir\/fix\.ts\/a-failure-keeps-the-folder\n/)
  assert.match(p.ubq('failures').out, /\n  testdir: \.ubq\/testdir\/fix\.ts\/a-failure-keeps-the-folder\n/)
  // The same results with many files, in a child process.
  assert.equal(p.ubq('fix.ts', 'pass.ts').last, 'fail: 3 failed, 9 passed, 1 skipped')
})

test('testdir makes a folder that has the name of the test', () => {
  const dir = testdir({ 'a.txt': 'a', sub: { 'b.txt': 'b' } })
  assert.match(dir, /\.ubq\/testdir\/test\/fixtures\.test\.ts\/testdir-makes-a-folder-that-has-the-name-of-the-test$/)
  assert.equal(readFileSync(join(dir, 'sub/b.txt'), 'utf8'), 'b')
  assert.equal(existsSync(join(dir, '../../../../.gitignore')), true)
})

test('a spy records its calls', () => {
  const add = spy((a: number, b: number) => a + b)
  assert.equal(add(1, 2), 3)
  assert.deepEqual(add.calls, [{ args: [1, 2], result: 3 }])
  const object = { name: 'x', greet(greeting: string) { return `${greeting} ${this.name}` } }
  const greet = spyOn(object, 'greet')
  assert.equal(object.greet('hello'), 'hello x')
  assert.deepEqual(greet.calls[0]?.args, ['hello'])
  // A method of a class is on the prototype.
  class Counter { n = 0; add() { return ++this.n } }
  const counter = new Counter()
  const count = spyOn(counter, 'add', () => 7)
  assert.equal(counter.add(), 7)
  assert.equal(count.calls.length, 1)
  assert.throws(() => spyOn(object, 'name' as 'greet'), /name is not a function of the object/)
})

test('mockImport gives a new module instance with mocked dependencies', async () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  const r = p.ubq('mock.ts')
  assert.equal(r.err, '')
  assert.deepEqual(r.out.replace(/ \(run \d+\)\n$/, '').split('\n'), [
    'FAIL mock.ts > a mock that lacks an export',
    '  Error: the mock of ./db.ts has no export "fetchUser", and the code under test imports it. Add "fetchUser" to the mock.',
    '  at mock.ts:29:3',
    "  > await mockImport(() => import('./src/greet.ts'), [[() => import('./src/db.ts'), { table: 'x' }]])",
    '  rerun: ubq mock.ts:28',
    '',
    'FAIL mock.ts > a loader that is not an import',
    "  TypeError: the first argument of mockImport must be an arrow function of the form () => import('...')",
    '  at mock.ts:35:9',
    '  > await mockImport(() => Promise.resolve(real), [])',
    '  rerun: ubq mock.ts:33',
    '',
    'fail: 2 failed, 2 passed',
  ])
  // Code that ran in a mocked instance is coverage of the real file.
  assert.deepEqual(p.ubq('covers', 'src/word.ts:3').out.trimEnd().split('\n'), [
    'mock.ts > a mock reaches the modules that the module imports, and builtins',
    'mock.ts > a mock replaces a dependency in a new instance of the module',
    'mock.ts > a mock that lacks an export',
    'mock.ts (while the file loads)',
    '3 tests run src/word.ts:3',
  ])
  // In a child process, and as a plain program.
  assert.equal(p.ubq('mock.ts', 'pass.ts').last, 'fail: 2 failed, 7 passed, 1 skipped')
})

test('mockImport works in this file', async () => {
  const { join } = await mockImport(() => import('./fixtures/src/joiner.ts'), [
    [() => import('node:path'), { join: (...parts) => parts.join('+') }],
  ])
  assert.equal(join('a', 'b'), 'a+b')
})

test('a test that changes the environment or the working directory fails', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  env({ LEAK_B: 'b' })
  const r = p.ubq('leak.ts')
  assert.deepEqual(r.out.replace(/ \(run \d+\)\n$/, '').split('\n').map(l => l.replace(/to \/.* and/, 'to DIR and')), [
    'FAIL leak.ts > sets a variable',
    '  the test changed the environment variable LEAK_A, LEAK_B and did not put it back. Use env({ LEAK_A: value }): it puts the old value back when the test ends.',
    '  at leak.ts:6:1',
    "  > test('sets a variable', () => {",
    '  rerun: ubq leak.ts:6',
    '',
    'FAIL leak.ts > changes the working directory',
    '  the test changed the working directory to DIR and did not put it back. Put it back with cleanup(): const old = process.cwd(); cleanup(() => process.chdir(old))',
    '  at leak.ts:17:1',
    "  > test('changes the working directory', () => {",
    '  rerun: ubq leak.ts:17',
    '',
    'fail: 2 failed, 2 passed',
  ])
})
