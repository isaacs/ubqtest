# Test API

The API for test files. Status: the user accepted it on 2026-11-11
(D15 to D18 in `02-decisions.md`).

The type sketch is in `experiments/api/ubq.ts`. `good.ts` there
compiles, and each line of `bad.ts` gives the compile error that
this document claims. `mock-rt.ts` proves the mock call at run time
on Node and Deno.

Not in this document: the CLI (`ubq guide`) and the config
(`08-config.md`).

## 1. A full example

```ts
import { test, describe, assert, spy, testdir, mockImport } from 'ubqtest'
import { parse } from '../src/parse.ts'

describe('parse', () => {
  test('circle', () => {
    const shape = parse('c')
    assert(shape)                       // narrows away undefined
    assert(shape.kind === 'circle')     // narrows the union
    assert.equal(shape.r, 1)
  })

  test('unknown input', () => {
    assert.throws(() => parse('?'), /unknown shape/)
  })

  for (const [input, kind] of [['c', 'circle'], ['s', 'square']] as const) {
    test(`kind of ${input}`, () => {
      assert.match(parse(input), { kind })
    })
  }
})

test('greet reads the user from the db', async () => {
  const fetchUser = spy(async (id: number) => ({ id, name: 'ada' }))
  const { greet } = await mockImport(() => import('../src/greet.ts'), [
    [() => import('../src/db.ts'), { fetchUser }],
  ])
  assert.equal(await greet(7), 'hello ada')
  assert.deepEqual(fetchUser.calls[0]?.args, [7])
})

test('writes a report', { timeout: 500 }, async ({ signal }) => {
  const dir = testdir({ 'in.json': '{"n":1}' })
  await writeReport(dir, { signal })
  assert.match(readFileSync(`${dir}/report.txt`, 'utf8'), /n = 1/)
})
```

`node test/parse.ts` runs this file. So does `ubq test/parse.ts`.

## 2. Design rules

1. **The first guess must work, or the error must name the fix.**
   Names come from `node:assert/strict`, Vitest, and tap, in that
   order of preference, because those names are the most common in
   existing code. A common wrong guess (`test.skip`, `assert.ok`,
   `assert.strictEqual`) is a compile error whose text is the
   correct call. See section 9.
2. **One way to do each thing** (D2). No aliases.
3. **Few tokens.** No chains, no wrappers, no setup code that
   repeats in each file.
4. **Types carry the rules.** `assert(value)` narrows the type of
   its argument. A mock must match the module that it replaces. A
   comparison of a `string` with a `number` does not compile.
5. **A test contains all that it needs.** No hooks, and no state
   that a reader must look for in a different part of the file.
6. **Plain code.** `test` and `describe` are function calls. A loop
   makes many tests. An `if` makes a test conditional.

## 3. `test`

```ts
test(name: string, fn: (ctx: { signal: AbortSignal }) => void | Promise<void>): void
test(name: string, options: { skip?: string | false; timeout?: number }, fn): void
```

- A test passes if `fn` returns (or its promise resolves) and one
  or more assertions ran.
- A test with zero assertions fails.
- Tests in a file run one at a time (D5).
- Tests must not depend on each other or on their order. The CLI
  runs single tests by ID. Test files run in a random order, and
  the tests of one file run in the order of the file (D28).
- `name` must be unique in its `describe` group. A duplicate is an
  error of the file, because the name is part of the test ID
  (`test/parse.ts > parse > circle`). The other tests run, and the
  run shows each duplicate.
- `timeout` is in milliseconds. The default is 5000, the same as
  Vitest and Jest.
- `skip(reason)` of the argument ends the test as skipped, with
  the reason (D117). It is for a condition that the test knows
  only while it runs: the `skip` option is for one that is known
  when the file loads. A test with a failure at that point is a
  failure.
- `signal` aborts when the test times out. Pass it to `fetch`,
  child processes, and timers, so that they stop with the test.
- `skip` takes the reason as a string. The summary prints each
  skipped test with its reason. `false` means "do not skip", which
  permits a condition:
  `{ skip: process.platform === 'win32' && 'needs fork' }`.
- A call to `test` or `describe` from inside a running test is an
  error.

## 4. `describe`

```ts
describe(name: string, fn: () => void): void
describe(name: string, options: { skip?: string | false; timeout?: number }, fn): void
```

A group gives its tests a name prefix and can give them options.
It does nothing else.

- `fn` runs at once, and it must be synchronous. A promise from
  `fn` is an error.
- Groups can nest.
- There are no hooks. For shared setup, write a function and call
  it in each test (section 7).

## 5. `assert`

A failed assertion throws. The test stops at its first failure.

```ts
assert(value, message?)                        // asserts value
assert.equal(actual, expected, message?)
assert.notEqual(actual, expected, message?)
assert.deepEqual(actual, expected, message?)
assert.match(actual, pattern, message?)
assert.contains(actual, expected, message?)
assert.notContains(actual, expected, message?)
assert.greaterThan(value, target, message?)
assert.lessThan(value, target, message?)
assert.greaterThanOrEqual(value, target, message?)
assert.lessThanOrEqual(value, target, message?)
assert.close(value, target, precision?, message?)
assert.throws(fn, expected, message?)          // returns the Error
await assert.rejects(promise, expected, message?)  // resolves to the Error
await assert.eventually(fn, pattern, message?) // as match; calls fn until it matches, 2000 ms at most
assert.snapshot(value, message?)               // compares with saved text
assert.fail(message)                           // returns never
```

| Function | Passes when |
| --- | --- |
| `assert(value)` | `value` is truthy. Use it to narrow: `assert(user)`, `assert(err instanceof HttpError)`. |
| `equal` | `Object.is(actual, expected)`. |
| `notEqual` | not `Object.is(actual, expected)`. |
| `deepEqual` | same structure, same values, same prototypes. The rules of `assert.deepStrictEqual` in Node. |
| `match` | `actual` has the shape of `pattern`. See below. |
| `matchOnly` | as `match`, and `actual` has no key that the pattern does not have, at each depth (D124). |
| `contains` | the text `actual` has the text `expected` in it, or an element of the iterable `actual` is `expected` (by the rule of `Array.prototype.includes`). `null` and `undefined` fail. A failure shows the text, or the part of long text near the longest start of `expected` that it has. |
| `notContains` | the opposite of `contains`. `null` and `undefined` fail. |
| `greaterThan`, `lessThan`, `greaterThanOrEqual`, `lessThanOrEqual` | `value > target`, `value < target`, `value >= target`, `value <= target`, for a `number` or a `bigint`. A failure shows the two values, which `assert(a > b)` cannot. The type of `value` can have `null` and `undefined` (`row?.count`): such a value fails (D127). |
| `close` | the difference of `value` and `target` is less than `10 ** -precision / 2`. The default `precision` is 2: less than 0.005. This is the rule of `toBeCloseTo` in jest and vitest. A `value` of `null` or `undefined` fails. |
| `throws` | `fn` throws an error that fits `expected`. |
| `rejects` | the promise (or the promise that the function returns) rejects with an error that fits `expected`. |

`isDeepEqual(a, b)` returns true or false by the rules of
`deepEqual`, `isMatch(actual, pattern)` by the rules of `match`,
and `isMatchOnly(actual, pattern)` by the rules of `matchOnly`
(D50, D123, D124). They are not assertions. If `assert(value)`
fails, the report shows the two values and the result of each
such call since the last assertion, 8 at most (D91). A call that
gave false also has the place of its first difference. So
`assert(s.calls.some(call => isDeepEqual(call.args, ['a'])))`
shows the arguments of each call of the spy, and
`assert(s.calls.some(call => isMatch(call.args, [{ id: 7 }])))`
passes if a call has one argument with that `id`.

**`match` patterns.** One function covers "looks like this":

- A `RegExp` matches a string that it tests true for.
- An object matches if each key in the pattern matches the same
  key in the value. Extra keys in the value are fine.
- An array matches an array of the same length, element by
  element.
- A function is a predicate. It gets the value at its place, and
  the value matches if the function returns `true`. The object
  `any` has the functions for "a number" or "a `URL`": see
  below. A key that the value does
  not have gives `undefined`. A failure shows the path, the
  value, and the text of the function.
- A key with the value `undefined` in a pattern must be in the
  value, with the value `undefined`.
- The type of a function in a pattern must be `(value: unknown)
  => boolean`. Any other function is a compile error, so that a
  function that the test wants to compare as a value is not
  called by accident. Use `assert.equal` for such a function. At
  run time, a result that is not `true` or `false` fails, and the
  failure says so.
- Any other value matches by `Object.is`.

```ts
assert.match(res, { status: 200, body: { user: { name: /^a/ } } })
assert.match(user, {
  id: any.number,
  home: any.instanceOf(URL),
  tags: [(v: unknown) => v !== ''],
})
```

**`any`** is an object with the functions for a pattern that
tests use most (D128). Each one is a predicate, so it works in
each place that takes a pattern. A failure shows its name:
`expected: any.number`.

| Function | The value at its place |
| --- | --- |
| `any.number`, `any.string`, `any.boolean`, `any.bigint`, `any.symbol`, `any.function` | has that `typeof`. |
| `any.object` | is an object or an array. Not `null`, and not a function. |
| `any.array` | is an array. |
| `any.defined` | is not `null` and not `undefined`. |
| `any.instanceOf(Class)` | is an instance of the class. |
| `any.arrayWith(...patterns)` | is an array that has, for each pattern, an element that matches it by the rules of `match`: an object is partial. The array can have other elements, in each order. |

```ts
assert.match(res, { rows: any.arrayWith({ id: 7 }), next: any.string })
```

`deepEqual` has no predicate: it compares a function as a value.
At the top level of `expected` in `throws` and `rejects`, a
function is a class (D85).

The pattern must fit the type of the value. For a pattern that
does not, on purpose: `assert.match<unknown>(value, pattern)`.

**`matchOnly`** is an exact comparison with the forms of a
pattern. An object in the pattern matches an object with the same
keys and no others, at each depth. It is for a value with a part
that changes from run to run:

```ts
assert.matchOnly(event, { id: 1, time: any.number })
```

`deepEqual` of the same value needs the exact time. `match` passes
if the event has keys that the test did not expect. As in `match`,
an object of a class matches a plain object in the pattern, and a
key with the value `undefined` is a key.

This keeps expected values short when the full object is large.

**`expected` in `throws` and `rejects`** is required. A test that
accepts any error also accepts a typing mistake in the code under
test.

- A `RegExp` tests the message.
- A class tests `instanceof`.
- An object is a `match` pattern for the error. For an error
  that is equal to an instance: `{ message: error.message }`.

`rejects` takes a `PromiseLike` too. A value that is not an
`Error` has no form of its own: a `RegExp` tests its text, and
the assertion returns the value, so `assert.equal` can compare it
(D89).

Both return the error, so more assertions can follow:

```ts
const err = assert.throws(() => parse('?'), ParseError)
assert.equal(err.message, 'unknown shape: ?')
```

**`rejects` must be awaited.** If the test ends and nothing awaited
the result, the test fails with a message that says so.

**`snapshot`** compares the text of a value with the text that an
older run saved (D31).

- The text of a string is the string. The text of any other value
  is its `util.inspect` form, with sorted keys and no size limit.
  Each entry of an array or an object is on its own line, so a
  change of one entry is a change of one line (D121).
- Each test file has one snapshot file:
  `ubq-snapshots/<test file path>.snap`. Commit it. The key of an
  entry is the names of the test, the message of the assertion if
  it has one, and the number of the call in the test with that
  message: `parse > circle 1`, `parse > circle > radius 1`. Each
  space, tab, or line end in the message is one space in the key.
  A new assertion with a message changes no key of an assertion
  with a different message.
- The file has LF line ends, and a CR of a value is `\r` in it.
  A file that git checked out with CRLF line ends on Windows has
  the same entries.
- A value with no saved text fails. A plain run never writes the
  file. `ubq --update <file>` or `ubq --update '<test id>'` runs
  the named tests and writes their snapshots. `ubq --update` with
  no test runs all tests and writes all snapshots (D76).
- An update of one test keeps the entries of the other tests. An
  entry of a test that the file no longer has is removed.
- The failure shows the lines that differ, and the command that
  writes the new text.
- The text can differ between runtimes: Node, Deno, and Bun do not
  print each value the same way.

**Types.**

- `assert(value)` narrows, as the example shows. `assert.equal`
  does not narrow (D98): a second `assert.equal` on a value that
  the code changed is not a type error.
  This works because `assert` is an import with a declared type.
  It would not work for a method of a context argument (TypeScript
  requires an explicit type on the receiver of an assertion
  function). That is the reason assertions are not on a `t` object.
- `expected` must be assignable to the type of `actual`.
  `assert.equal(count, '1')` does not compile when `count` is a
  number.
- Outside a test, an assertion is a function that throws if its
  check fails (D117): at the top level of a file, or in a
  `cleanup()` of the file. The failure is an error of the file,
  with the values of the assertion. `assert.snapshot` needs a
  test.
- Each assertion takes a message as its last argument. A failure
  shows it before the text of the assertion.

Assertions find the current test through `AsyncLocalStorage`, which
has no measurable cost (`03-measurements.md`, section 8). An
assertion that runs after its test ended fails that test.

## 6. Mocks and spies

### `spy`, `spyOn`

```ts
spy<F>(impl?: F): Spy<F>
spy.results<R>(...results: (R | Error)[]): Spy<(...args) => R>
spyOn(object, key, impl?): Spy<typeof object[key]>
```

- A spy is a function that records each call in `spy.calls`, as
  `{ args, result, error, this }`. `this` is the `this` value of
  the call (D124). It is not enumerable, so `deepEqual` of a call
  with `{ args, result }` does not see it:
  `assert.equal(s.calls[0]?.this, emitter)`. `args` has the type `unknown[]`
  (D123): the code under test can pass more arguments than the
  type of the function has, and an expected value of each type
  compares with it. To read a property of an argument, test its
  type first.
- `spyOn` replaces a method and puts the original back when the
  test ends.
- There are no special assertions for spies. Use `assert.equal`
  and `assert.deepEqual` on `calls`.
- With no `impl`, `spy()` returns `undefined`, takes any
  arguments, and fits each function type, and `spyOn` calls the
  original method. With an `impl`, the spy has the type of the
  `impl`: if the test calls the spy itself, give the `impl` the
  parameters of that call (`spy((event: Event) => event)`). A spy that goes to a typed option gets the types
  of the option: `{ beforeSend: spy(event => event) }`. `result` of an async function is its
  promise. `error` is present only if the call threw.
- The key of `spyOn` must name a function of the object. A
  different key is a compile error.
- `spy.results(a, b)` is a spy that gives `a` to call 1 and `b`
  to call 2 (D109). A result that is an Error instance is thrown.
  A call after the last result throws: a call that the test did
  not expect is a failure, not `undefined`. For an async
  function, the results are promises. The spy does not change
  after it is made, as each spy (D87).

### `mockImport`

```ts
const subject = await mockImport(
  () => import('../src/greet.ts'),
  [
    [() => import('../src/db.ts'), { fetchUser }],
    [() => import('node:fs'), { readFileSync: () => '{}' }],
  ],
)
```

- The first argument loads the module under test. The result is a
  new instance of that module, with its own state.
- Each pair names a dependency and the exports that replace it.
- All types come from the `import()` expressions. A mock with a
  wrong signature, or a key that the real module does not export,
  is a compile error.
- The mock exists only in the module instance that the call
  returns. Nothing needs a reset.
- Nothing moves to the top of the file, and the source is not
  rewritten. The mock functions are normal values in normal scope.

The loaders must be arrow functions of the form
`() => import('...')`. The library reads the module path from the
`import()` call through a resolve hook. A mock loader does not load
the real dependency.

- A mock of a function with overloads (`readFileSync`) can be a
  function that fits the last overload.
- The module under test gets a new instance, and so does each
  project module that it imports. Packages in `node_modules` and
  builtins are not loaded again.
- If the code under test imports a name that the mock does not
  have, the call fails with an error that names the export to add.
- A mock with no `default` export gets one: the mock object. So
  `import fs from 'node:fs'` works with a mock of named exports.
- A CommonJS module is in the instance too (D111): the JavaScript
  of the `transform` key can be CommonJS. Node keeps one module
  for each file, and a `require` does not go through the resolve
  hook with the URL of the instance. So the load hook gives each
  CommonJS module of an instance its own `require`, which gives
  the mock of a mocked dependency, and loads a new module for
  each project file, one time for each instance. In a CommonJS
  instance, a dependency that is an ES module is not new.

Built in `src/mock.ts`. Node and Deno use the hooks of
`module.registerHooks`. Bun has no such hooks, so the library uses
`Bun.plugin` there. Differences on Bun:

- The library writes the mock number into the import paths of
  each module instance, when Bun loads the instance. It finds the
  imports by their text: `from '...'`, `import '...'`,
  `import('...')`. An `import()` with a path that is not a string
  literal gets the real module.
- A mock loader of a package, of a builtin, or of a relative path
  with no extension loads the real module one time. Bun calls no
  resolve hook for them. The library reads the name from the text
  of the loader, and finds the module from the folder of the file
  that called `mockImport`.
- The error for a mock that lacks an export names the file by its
  path from the project root (`src/db.ts`), not as the code under
  test wrote it (`./db.ts`).

## 7. Fixtures and cleanup

A fixture is a function that a test calls. It sets something up
and removes it when the test ends. The test does not have to ask
for the removal.

```ts
testdir(files?: Files): string     // a new folder, removed at test end
env(vars: Record<string, string | undefined>): void   // set or delete, put back at test end
stub(object, key, value): void                       // set a property, put back at test end
cleanup(fn: () => void | Promise<void>): void         // run fn at test end
```

- `testdir({ 'a.txt': 'hi', sub: { 'b.json': '{}' } })` makes the
  files and returns the path.
- The path comes from the test ID:
  `.ubq/testdir/<test file path>/<test name>`, with characters
  that are not safe in a path replaced by `-`. A second call in
  the same test adds `-2`. An agent can find the folder with no
  need to read the output.
- When the test passes, the folder is removed. When the test
  fails, the folder stays, and the failure block prints its path.
  The next run of that test removes the old folder first.
- All of `.ubq/` is ignored by git: the tool writes
  `.ubq/.gitignore`, and one `.ubq/` line in a project
  `.gitignore` also covers it. The folder is in the project, so
  git worktrees do not collide.
- `stub(globalThis, 'navigator', value)` sets a property of an
  object. The old property comes back when the test ends: its
  value or its getter, or no property if the object had none of
  its own. The value has the type of the property, if the object
  type has the key, or is `undefined` (D125). For a function, `spyOn` also records the
  calls. A property that is not configurable throws.
- `cleanup` functions run in reverse order. An error in one fails
  the test.
- A fixture call outside a test (at the top level of the file)
  lasts until the file ends. This is the way to share a costly
  resource: `const server = await startServer(); cleanup(() =>
  server.close())`.

- A fixture at the top level must come before the first `test`
  call, and the `test` calls must have no `await` between them.
  The cleanup functions of the file run after the last test in the
  queue. A `test` call or a fixture call after that is an error.
- A fixture call after its test ended is a failure of that test
  (`late`). Each cleanup function has the time limit of its test.
  A cleanup function of the file has the `timeout` of the
  configuration, or 5000 ms.

### `fakeClock`

```ts
const clock = fakeClock({ now?: number | Date })
clock.now                 // milliseconds since 1970
clock.timers              // count of timers that wait
await clock.tick(ms)      // move forward, run each timer that is due
await clock.runAll()      // move from timer to timer until none waits
clock.set(time)           // set the time of Date, run no timer
clock.restore()           // the real clock comes back
```

- The clock belongs to the test that made it. The real clock comes
  back when the test ends, or at `clock.restore()`, or at the end
  of a `using clock = fakeClock()` block. One clock at a time.
- It replaces all that it can (D30): `setTimeout`, `setInterval`,
  `setImmediate` and their `clear` functions, `Date`,
  `performance.now`, `process.hrtime`, `AbortSignal.timeout`, and
  the same functions in `node:timers` and `node:timers/promises`.
- `set(time)` sets the time of `Date`, forward or back, and runs
  no timer. `performance.now`, `process.hrtime`, and the timers do
  not change: a timer runs after the same count of milliseconds.
- Time moves only in `tick` and `runAll`. Timers run in the order
  of their times. Promise callbacks run after each timer, so a
  chain of `await sleep(10)` calls ends in one `tick`.
- `tick` and `runAll` return promises. There is no sync form.
- As in Node, a timer time below 1 ms, above 2^31 - 1 ms, or not a
  finite number, is 1 ms (D57). So `tick(0)` runs only the
  `setImmediate` callbacks, and the promise callbacks. To run a
  `setTimeout(fn, 0)`, use `tick(1)`.
- `runAll` fails after 10000 timers: a `setInterval` never ends.
- The time limit of the test, and the times in reports, use the
  real clock.
- `queueMicrotask` and `process.nextTick` are not replaced.

To share setup between tests, write a function:

```ts
const setup = () => {
  const dir = testdir({ 'config.json': '{}' })
  env({ APP_HOME: dir })
  return { dir, app: createApp() }
}

test('starts', () => {
  const { app } = setup()
  assert.equal(app.state, 'ready')
})
```

Each test gets new values. Nothing is shared by accident.

## 8. What is absent, and what to use

| Absent | Use |
| --- | --- |
| `expect(x).toBe(y)` chains | `assert.equal(x, y)`. Chains cannot narrow types, cost more tokens, and have many near-equal matchers. |
| `it` | `test` |
| `beforeEach`, `afterEach`, `beforeAll`, `afterAll` | a setup function, fixtures, top-level code, `cleanup` |
| `test.only`, `describe.only` | `ubq <file>:<line>` or `ubq '<test id>'` |
| `test.skip`, `test.todo`, `skipIf`, `runIf` | `{ skip: 'reason' }`, with a condition if necessary |
| `test.each` | a `for` loop |
| `test.concurrent` | none. Files run in parallel, tests in a file do not (D5). |
| `retry` | none. `ubq --repeat N` measures a flaky test and does not hide it. |
| `t.test` subtests, `t.plan`, `t.end` | `describe` for groups. The end of a test is the end of its function. |
| `vi.mock`, `jest.mock` | `mockImport` |
| `vi.fn`, `jest.fn`, `mock.fn` | `spy` |
| `strictEqual`, `deepStrictEqual`, `ok`, `toEqual` | `equal`, `deepEqual`, `assert(value)` |
| `doesNotThrow` | call the function, then assert on its result |
| soft assertions that let the test continue | none. One failure for each test keeps the output short. |

## 9. Errors for wrong guesses

Names that an agent is likely to try exist in the types as
properties that cannot be called. The compile error contains the
fix. At run time, the same call throws the same text.

```
test.skip('x', () => {})
  error TS2349: This expression is not callable.
  Type 'Hint<"Use test(name, { skip: \"reason\" }, fn)">' has no call signatures.
```

| Call | Text of the error |
| --- | --- |
| `test.skip` | `Use test(name, { skip: "reason" }, fn)` |
| `test.todo` | `Use test(name, { skip: "todo: reason" }, fn)` |
| `test.only` | `ubq has no .only. Select tests on the command line: ubq <file>:<line>` |
| `test.each` | `Use a for loop around test()` |
| `assert.ok` | `Use assert(value)` |
| `assert.strictEqual` | `Use assert.equal (it is always strict)` |
| `assert.deepStrictEqual` | `Use assert.deepEqual (it is always strict)` |
| `assert.toMatchSnapshot`, `assert.matchSnapshot` | `Use assert.snapshot(value)` |

`it`, `expect`, and the hook names are not exports. An import of
one fails with the normal "no exported member" error. The agent
guide in the package lists the replacement for each.

## 10. Where each part comes from

| Part | Source | Change |
| --- | --- | --- |
| `test(name, options, fn)`, `describe` | Vitest, `node:test` | no hooks, no modifiers |
| `assert.equal`, `deepEqual`, `throws`, `rejects`, `match`, `fail` | `node:assert/strict` | `expected` is required for `throws` and `rejects`, and both return the error |
| `match` with object patterns, `matchOnly` | tap `t.match`, `t.matchOnly` | no constructor patterns |
| `testdir(files)` | tap `t.testdir` | a free function |
| `mockImport` | tap `t.mockImport` | paths and types come from `import()` expressions |
| `spy`, `spyOn` | Vitest `vi.fn`, `vi.spyOn` | calls are plain records, no special assertions |
| `{ signal }` | Vitest, `node:test` | |
| 5000 ms timeout | Vitest, Jest | |

## 11. Open points

- **`match` patterns have no type matchers** (tap permits
  `{ id: Number }`). Add them only if tests need them often.
- **Snapshots across runtimes.** The text comes from `util.inspect`,
  which differs between runtimes. A formatter of our own would fix
  this.
