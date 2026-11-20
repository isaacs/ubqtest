// Fixtures, spies, and module mocks: cleanup, env, stub, testdir,
// spy, spyOn, mockImport.
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  any,
  assert,
  cleanup,
  env,
  isDeepEqual,
  isMatch,
  isMatchOnly,
  mockImport,
  spy,
  spyOn,
  stub,
  test,
  testdir,
} from 'ubqtest'
import { project } from './setup.ts'

test('fixtures end with their test, and a failed test keeps its testdir', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  // fix.ts checks that a variable has its old value after a test.
  env({ FIX_B: 'b' })
  const r = p.ubq('fix.ts')
  assert.equal(r.err, '')
  assert.deepEqual(r.out.replace(/ \(run \d+[^)]*\)\n$/, '').split('\n'), [
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

test('stub sets a property, and the old one comes back when the test ends', () => {
  class Base {
    get inherited() {
      return 'base'
    }
  }
  const object = new Base() as Base & { plain: number; getter: string; fixed: number; added?: string }
  object.plain = 1
  Object.defineProperty(object, 'getter', { get: () => 'real', enumerable: false, configurable: true })
  Object.defineProperty(object, 'fixed', { value: 1, configurable: false })
  // A cleanup runs after the cleanups that the test adds later.
  cleanup(() => {
    const own = (key: string) => Object.getOwnPropertyDescriptor(object, key)
    assert.deepEqual(
      [object.plain, object.getter, object.inherited, 'added' in object, own('inherited'), own('getter')?.enumerable],
      [1, 'real', 'base', false, undefined, false],
    )
    assert.equal((globalThis as { ubqStub?: number }).ubqStub, undefined)
  })
  stub(object, 'plain', 2)
  stub(object, 'getter', 'stubbed')
  stub(object, 'inherited', 'own')
  stub(object, 'added', 'new')
  stub(globalThis, 'ubqStub', 3)
  assert.deepEqual([object.plain, object.getter, object.inherited, object.added], [2, 'stubbed', 'own', 'new'])
  assert.equal((globalThis as { ubqStub?: number }).ubqStub, 3)
  assert.throws(() => stub(object, 'fixed', 2), /stub: fixed cannot be changed/)
  assert.equal(object.fixed, 1)
  // The value undefined fits a key whose type has no undefined.
  const real = globalThis.performance
  cleanup(() => assert.equal(globalThis.performance, real))
  stub(globalThis, 'performance', undefined)
  assert.equal<unknown>(globalThis.performance, undefined)
})

test('testdir makes a folder that has the name of the test', () => {
  const dir = testdir({ 'a.txt': 'a', sub: { 'b.txt': 'b' } })
  assert.match(
    dir.replaceAll('\\', '/'),
    /\.ubq\/testdir\/test\/fixtures\.test\.ts\/testdir-makes-a-folder-that-has-the-name-of-the-test$/,
  )
  assert.equal(readFileSync(join(dir, 'sub/b.txt'), 'utf8'), 'b')
  assert.equal(existsSync(join(dir, '../../../../.gitignore')), true)
})

test('a spy records its calls', () => {
  const add = spy((a: number, b: number) => a + b)
  assert.equal(add(1, 2), 3)
  assert.deepEqual(add.calls, [{ args: [1, 2], result: 3 }])
  const object = {
    name: 'x',
    greet(greeting: string) {
      return `${greeting} ${this.name}`
    },
  }
  const greet = spyOn(object, 'greet')
  assert.equal(object.greet('hello'), 'hello x')
  assert.deepEqual(greet.calls[0]?.args, ['hello'])
  // A method of a class is on the prototype.
  class Counter {
    n = 0
    add() {
      return ++this.n
    }
  }
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
  assert.deepEqual(r.out.replace(/ \(run \d+[^)]*\)\n$/, '').split('\n'), [
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
    'mock.ts (while the file loads)',
  ])
  // In a child process, and as a plain program.
  assert.equal(p.ubq('mock.ts', 'pass.ts').last, 'fail: 2 failed, 7 passed, 1 skipped')
})

test('mockImport works in this file', async () => {
  const { join } = await mockImport(
    () => import('./fixtures/src/joiner.ts'),
    [[() => import('node:path'), { join: (...parts) => parts.join('+') }]],
  )
  assert.equal(join('a', 'b'), 'a+b')
})

test('a test that changes the environment or the working directory fails', () => {
  const p = project()
  cleanup(() => rmSync(p.dir, { recursive: true }))
  env({ LEAK_B: 'b' })
  const r = p.ubq('leak.ts')
  assert.deepEqual(
    r.out
      .replace(/ \(run \d+[^)]*\)\n$/, '')
      .split('\n')
      .map(l => l.replace(/to (\/|[A-Z]:\\).* and/, 'to DIR and')),
    [
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
    ],
  )
})

test('isDeepEqual gives true or false, by the rules of deepEqual', () => {
  const list = [{ contents: 'read' }, { contents: 'write' }]
  assert.deepEqual(
    [
      list.some(item => isDeepEqual(item, { contents: 'write' })),
      list.some(item => isDeepEqual(item, { contents: 'admin' })),
      isDeepEqual([1, { a: undefined }], [1, {}]),
      isDeepEqual(1, '1'),
    ],
    [true, false, false, false],
  )
})

test('isMatch gives true or false, by the rules of match', () => {
  const s = spy((event: { id: number; name: string }) => event.id)
  s({ id: 1, name: 'ann' })
  s({ id: 2, name: 'bob' })
  const user: { id: number; name?: string } = { id: 1 }
  assert.deepEqual(
    [
      s.calls.some(call => isMatch(call.args, [{ name: /^b/ }])),
      s.calls.some(call => isMatch(call.args, [{ id: 3 }])),
      // An array in a pattern has the length of the value.
      s.calls.some(call => isMatch(call.args, [{ id: 1 }, 'more'])),
      isMatch(user, { id: (v: unknown) => typeof v === 'number' }),
      // A key with the value undefined in a pattern must be in the value.
      isMatch(user, { name: undefined }),
      isMatch({ ...user, name: undefined }, { name: undefined }),
    ],
    [true, false, false, true, false, true],
  )
})

test('matchOnly and isMatchOnly: a pattern with no other keys in the value, at each depth', () => {
  const event = { id: 1, time: Date.now(), user: { name: 'ann', tags: ['a'] } }
  const number = (v: unknown): boolean => typeof v === 'number'
  assert.matchOnly(event, { id: 1, time: number, user: { name: /^a/, tags: ['a'] } })
  // A class instance matches a plain pattern, as in match.
  assert.matchOnly(
    new (class Point {
      x = 1
    })(),
    { x: number },
  )
  const s = spy()
  s(event, 'more')
  assert.deepEqual(
    [
      isMatchOnly(event, { id: 1, time: number }),
      isMatchOnly(event, { id: 1, time: number, user: { name: 'ann' } }),
      // A key with the value undefined is a key.
      isMatchOnly({ id: 1, at: undefined }, { id: 1 }),
      // A function gets undefined for a key that the value does not have.
      isMatchOnly({ id: 1 }, { id: 1, at: (v: unknown) => v === undefined }),
      s.calls.some(call =>
        isMatchOnly(call.args, [{ id: 1, time: number, user: { name: 'ann', tags: ['a'] } }, 'more']),
      ),
    ],
    [false, false, false, true, true],
  )
})

test('any: the built-in functions for a pattern', () => {
  class Point {}
  const value = {
    n: 1,
    s: 'a',
    b: true,
    big: 1n,
    sym: Symbol('x'),
    fn: () => 1,
    o: {},
    list: [1, 'b', { id: 7, more: 1 }],
    at: new Point(),
    none: null,
  }
  assert.matchOnly(value, {
    n: any.number,
    s: any.string,
    b: any.boolean,
    big: any.bigint,
    sym: any.symbol,
    fn: any.function,
    o: any.object,
    list: any.array,
    at: any.instanceOf(Point),
    none: null,
  })
  // An array is an object, and each value that is there is defined.
  assert.match(value, { list: any.object, at: any.defined, n: any.defined })
  // An element for each pattern, in each order. An object is partial.
  assert.match(value, { list: any.arrayWith({ id: 7 }, any.string, 1) })
  assert.match(value.list, any.arrayWith())
  assert.deepEqual(
    [
      isMatch(value, { none: any.object }),
      isMatch(value, { fn: any.object }),
      isMatch(value, { none: any.defined }),
      isMatch<unknown>(value, { gone: any.defined }),
      isMatch(value, { n: any.string }),
      isMatch(value, { o: any.array }),
      isMatch(value, { o: any.instanceOf(Point) }),
      isMatch(value, { list: any.arrayWith({ id: 8 }) }),
      isMatch(value, { list: any.arrayWith(1, 2) }),
      isMatch(value, { n: any.arrayWith() }),
    ],
    [false, false, false, false, false, false, false, false, false, false],
  )
  // A failure shows the name, with its arguments.
  assert.deepEqual(
    [String(any.number), String(any.instanceOf(Point)), String(any.arrayWith({ id: 7 }, /b/))],
    ['any.number', 'any.instanceOf(Point)', 'any.arrayWith({ id: 7 }, /b/)'],
  )
})

test('a call of a spy has its this value, and deepEqual of the call does not see it', () => {
  const object = {
    greet: spy(function (this: unknown) {
      return 1
    }),
  }
  object.greet()
  const free = object.greet
  free()
  assert.equal(object.greet.calls[0]?.this, object)
  assert.equal(object.greet.calls[1]?.this, undefined)
  assert.deepEqual(object.greet.calls, [
    { args: [], result: 1 },
    { args: [], result: 1 },
  ])
  assert.match(object.greet.calls[0], { this: object })
})

test('the arguments of a call of a spy compare with a value of each type', () => {
  const none = spy(() => 1)
  const one = spy((name: string) => name)
  ;(none as (...args: unknown[]) => number)('more')
  one('ann')
  assert.deepEqual(none.calls[0]?.args, ['more'])
  assert.equal(one.calls[0]?.args[0], 'ann')
  // The type of the actual value can be unknown, with no second type argument.
  assert.match<unknown>(one.calls, [{ args: ['ann'] }])
})

test('spy.results gives each result in order, throws an Error result, and throws after the last one', async () => {
  const read = spy.results('a', 'b', new Error('no more'))
  // The type of a result is not the type of the Error in the list.
  const first: string = read(1, 2)
  assert.equal(first, 'a')
  assert.equal(read(), 'b')
  assert.throws(() => read(), /no more/)
  assert.throws(() => read(), /call 4 of a spy that has 3 results\. Give spy\.results\(\) a result for each call\./)
  assert.deepEqual(
    read.calls.map(call => [call.args, call.result, call.error instanceof Error]),
    [
      [[1, 2], 'a', false],
      [[], 'b', false],
      [[], undefined, true],
      [[], undefined, true],
    ],
  )
  // A promise that is rejected when the list is made, and that the
  // code gets later, is not an unhandled rejection.
  const load = spy.results(Promise.resolve(1), Promise.reject(new Error('gone')))
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.equal(await load(), 1)
  await assert.rejects(load(), /gone/)
  // It fits a typed function.
  const typed: (id: number) => Promise<number> = spy.results(Promise.resolve(2))
  assert.equal(await typed(1), 2)
})
