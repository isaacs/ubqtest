// Fixtures and spies: cleanup, env, testdir, spy, spyOn.
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { assert, cleanup, env, spy, spyOn, test, testdir } from 'ubqtest'
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
