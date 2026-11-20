# ubqtest API

Each export of the `ubqtest` package, with its type and its doc
comment. `npm run docs` makes this file from the type
declarations of the built package. Do not change it by hand. A
test fails if it is not current.

For how to use the API, with examples and the rules of a test,
read [GUIDE.md](../GUIDE.md) (`ubq guide`).

The package has three entry points. A test file imports most
names from `'ubqtest'`. `'ubqtest/browser'` is for a test of
front-end code, and `'ubqtest/workers'` is for a test of a
Cloudflare Worker. In each part of this page, the items are in
the order of the alphabet.

## Contents

- [`ubqtest`](#ubqtest)
  - [`assert`](#assert)
    - [`assert()`](#assert-1), [`assert.close`](#assert-close), [`assert.contains`](#assert-contains), [`assert.deepEqual`](#assert-deepequal), [`assert.equal`](#assert-equal), [`assert.eventually`](#assert-eventually), [`assert.fail`](#assert-fail), [`assert.greaterThan`](#assert-greaterthan), [`assert.greaterThanOrEqual`](#assert-greaterthanorequal), [`assert.lessThan`](#assert-lessthan), [`assert.lessThanOrEqual`](#assert-lessthanorequal), [`assert.match`](#assert-match), [`assert.matchOnly`](#assert-matchonly), [`assert.notContains`](#assert-notcontains), [`assert.notEqual`](#assert-notequal), [`assert.rejects`](#assert-rejects), [`assert.snapshot`](#assert-snapshot), [`assert.throws`](#assert-throws), [Names that `assert` does not have](#names-that-assert-does-not-have)
  - [`cleanup`](#cleanup)
  - [`describe`](#describe)
  - [`env`](#env)
  - [`fakeClock`](#fakeclock)
  - [`isDeepEqual`](#isdeepequal)
  - [`isMatch`](#ismatch)
  - [`isMatchOnly`](#ismatchonly)
  - [`mockImport`](#mockimport)
  - [`spy`](#spy)
    - [`spy()`](#spy-1), [`spy.results`](#spy-results)
  - [`spyOn`](#spyon)
  - [`stub`](#stub)
  - [`test`](#test)
    - [Names that `test` does not have](#names-that-test-does-not-have)
  - [`testdir`](#testdir)
- [`ubqtest/browser`](#ubqtest-browser)
  - [`browser`](#browser)
  - [`prepareContext`](#preparecontext)
- [`ubqtest/workers`](#ubqtest-workers)
  - [`executionContext`](#executioncontext)
  - [`migrate`](#migrate)
  - [`scheduledController`](#scheduledcontroller)
- [Types](#types)
  - [`Assert`](#assert-2)
  - [`FakeClock`](#fakeclock-1)
    - [`FakeClock[Symbol.dispose]`](#fakeclock-symbol-dispose), [`FakeClock.now`](#fakeclock-now), [`FakeClock.restore`](#fakeclock-restore), [`FakeClock.runAll`](#fakeclock-runall), [`FakeClock.set`](#fakeclock-set), [`FakeClock.tick`](#fakeclock-tick), [`FakeClock.timers`](#fakeclock-timers)
  - [`FakeClockOptions`](#fakeclockoptions)
    - [`FakeClockOptions.now`](#fakeclockoptions-now)
  - [`Files`](#files)
  - [`MockOf`](#mockof)
  - [`Pattern`](#pattern)
  - [`Spy`](#spy-2)
  - [`SpyCall`](#spycall)
  - [`SpyFunction`](#spyfunction)
  - [`TestContext`](#testcontext)
    - [`TestContext.signal`](#testcontext-signal), [`TestContext.skip`](#testcontext-skip)
  - [`TestFn`](#testfn)
  - [`TestOptions`](#testoptions)
    - [`TestOptions.skip`](#testoptions-skip), [`TestOptions.timeout`](#testoptions-timeout)
- [Types of the signatures](#types-of-the-signatures)
  - [`AnyFn`](#anyfn)
  - [`Arr`](#arr)
  - [`Checked`](#checked)
  - [`CheckedError`](#checkederror)
  - [`CleanupFn`](#cleanupfn)
  - [`Describe`](#describe-1)
  - [`ErrorMatch`](#errormatch)
  - [`Hint`](#hint)
  - [`Keyed`](#keyed)
  - [`Keys`](#keys)
  - [`Loader`](#loader)
  - [`MethodKeys`](#methodkeys)
  - [`Obj`](#obj)
  - [`PatternList`](#patternlist)
  - [`Predicate`](#predicate)
  - [`Prim`](#prim)
  - [`Same`](#same)
  - [`Test`](#test-1)
  - [`Val`](#val)

## `ubqtest`

Import from `'ubqtest'`.

### `assert`

The assertions. `assert(value)` passes if `value` is truthy, and
each method is one check. A failed assertion throws, and the test
stops there. The report has the place, the source line, and the
values. Each assertion takes a `message` as its last argument: it
goes before the text of the failure.

A test must run one assertion or more.

#### `assert()`

Passes if `value` is truthy. Narrows the type of `value`.

```ts
const user = find('ann')
assert(user)
assert(user.kind === 'admin')
assert(error instanceof RangeError, 'the kind of error')
```

```ts
assert(value: unknown, message?: string): asserts value;
```

#### `assert.close`

Passes if `value` is near `target`: the difference is less than
`10 ** -precision / 2`. The default `precision` is 2, a difference
of less than 0.005. Two values that are equal pass.

```ts
assert.close(0.1 + 0.2, 0.3)
assert.close(ratio, 1.15, 6)
```

```ts
assert.close(value: number, target: number, precision?: number, message?: string): void;
```

#### `assert.contains`

Passes if the text `actual` has the text `expected` in it, or if
an element of the iterable `actual` is `expected`. Fails on null
and undefined. For long text, a failure shows the part near
the longest start of `expected` that the text has.

```ts
assert.contains(page, 'Welcome')
assert.contains(new Set(roles), 'admin')
```

```ts
assert.contains(actual: string | null | undefined, expected: string, message?: string): void;
assert.contains<T>(actual: Iterable<T> | null | undefined, expected: T, message?: string): void;
```

#### `assert.deepEqual`

Passes if both have the same structure, values, and prototypes.
It is strict: `1` is not `'1'`, and a class instance is not a
plain object. A failure shows each difference with its path.

```ts
assert.deepEqual(parse('a=1'), { a: '1' })
```

```ts
assert.deepEqual<T>(actual: T, expected: NoInfer<T>, message?: string): void;
```

#### `assert.equal`

Passes if `Object.is(actual, expected)`. It does not narrow the
type of `actual`: a test often reads a value again after the
code under test changed it. To narrow, use `assert(a === b)`.
`expected` must have the type of `actual`. To compare two
different types on purpose: `assert.equal<unknown>(a, b)`.

```ts
assert.equal(add(1, 2), 3)
```

```ts
assert.equal<T>(actual: T, expected: NoInfer<T>, message?: string): void;
```

#### `assert.eventually`

As `match`, for a value that changes with time, such as the text
of a page. Calls `fn` again and again until its value matches
`pattern`. Fails after 2000 ms with the last value. The result
must be awaited.

```ts
await assert.eventually(() => page.title(), 'Done')
```

```ts
assert.eventually<T, const P extends Pattern<Awaited<T>> = Pattern<Awaited<T>>>(fn: () => T, pattern: P & Checked<P>, message?: string): Promise<void>;
```

#### `assert.fail`

Fails the test.

```ts
if (kind === 'never') assert.fail('this case cannot occur')
```

```ts
assert.fail(message: string): never;
```

#### `assert.greaterThan`

Passes if `value > target`. A failure shows the two values.

```ts
assert.greaterThan(items.length, 0)
```

```ts
assert.greaterThan(value: number | bigint, target: number | bigint, message?: string): void;
```

#### `assert.greaterThanOrEqual`

Passes if `value >= target`. A failure shows the two values.

```ts
assert.greaterThanOrEqual(value: number | bigint, target: number | bigint, message?: string): void;
```

#### `assert.lessThan`

Passes if `value < target`. A failure shows the two values.

```ts
assert.lessThan(elapsed, 100)
```

```ts
assert.lessThan(value: number | bigint, target: number | bigint, message?: string): void;
```

#### `assert.lessThanOrEqual`

Passes if `value <= target`. A failure shows the two values.

```ts
assert.lessThanOrEqual(value: number | bigint, target: number | bigint, message?: string): void;
```

#### `assert.match`

Passes if `actual` has the shape of `pattern`. Each key in the
pattern must match. Extra keys in `actual` are fine. A RegExp
tests a string. A function in the pattern gets the value at
its place, and the value matches if the function returns
true: `{ id: (v: unknown) => typeof v === 'number' }`. A key
that `actual` does not have gives `undefined`. To compare a
function as a value, use `assert.equal`. An array in the
pattern must have the same length as the array in `actual`.

```ts
assert.match(user, { name: /^A/, roles: ['admin'] })
assert.match(line, /^pass: /)
```

```ts
assert.match<T, const P extends Pattern<T> = Pattern<T>>(actual: T, pattern: P & Checked<P>, message?: string): void;
```

#### `assert.matchOnly`

As `match`, and `actual` must have no key that the pattern
does not have, at each depth. Use it for an exact comparison
with a value that changes: a function in the pattern tests
that value.

```ts
assert.matchOnly(event, { id: 1, time: (v: unknown) => typeof v === 'number' })
```

```ts
assert.matchOnly<T, const P extends Pattern<T> = Pattern<T>>(actual: T, pattern: P & Checked<P>, message?: string): void;
```

#### `assert.notContains`

The opposite of `contains`. Fails on null and undefined.

```ts
assert.notContains(actual: string | null | undefined, expected: string, message?: string): void;
assert.notContains<T>(actual: Iterable<T> | null | undefined, expected: T, message?: string): void;
```

#### `assert.notEqual`

Passes if not `Object.is(actual, expected)`.

```ts
assert.notEqual(nextId(), firstId)
```

```ts
assert.notEqual<T>(actual: T, expected: NoInfer<T>, message?: string): void;
```

#### `assert.rejects`

As `throws`, for a promise, or for a function that returns one.
The result must be awaited: a test that does not await it
fails. It resolves to the value that the promise rejected with.

```ts
await assert.rejects(load('gone'), /not found/)
```

```ts
assert.rejects<const P extends ErrorMatch>(promise: PromiseLike<unknown> | (() => PromiseLike<unknown>), expected: P & CheckedError<P>, message?: string): Promise<Error>;
```

#### `assert.snapshot`

Passes if the text of `value` is the text in the snapshot file
of the test file. `ubq --update <test>` writes the file. The
files are in `ubq-snapshots/`: commit them.

```ts
assert.snapshot(value: unknown, message?: string): void;
```

#### `assert.throws`

Passes if `fn` throws an error that fits `expected`: a RegExp
tests the message, a class tests `instanceof`, an object is a
`match` pattern. `expected` is required. Returns the error.

```ts
assert.throws(() => parse('?'), /unknown shape/)
const error = assert.throws(() => parse('?'), RangeError)
assert.throws(() => open(path), { code: 'ENOENT' })
```

```ts
assert.throws<const P extends ErrorMatch>(fn: () => unknown, expected: P & CheckedError<P>, message?: string): Error;
```

#### Names that `assert` does not have

Each of these names is a compile error, with the name to use in its place.

| Name | Use |
| --- | --- |
| `assert.deepStrictEqual` | Use assert.deepEqual (it is always strict) |
| `assert.matchSnapshot` | Use assert.snapshot(value) |
| `assert.ok` | Use assert(value) |
| `assert.strictEqual` | Use assert.equal (it is always strict) |
| `assert.toMatchSnapshot` | Use assert.snapshot(value) |

### `cleanup`

Runs `fn` when the test ends. Outside a test: when the file ends.
The functions run in reverse order. An error in one fails the test.

```ts
const server = listen(0)
cleanup(() => server.close())
```

```ts
const cleanup: (fn: CleanupFn) => void;
```

### `describe`

A group of tests. Its name is a part of the ID of each test in
it: `file > group > test`. `fn` runs while the file loads, and it
must not be async. The options are the default for each test of
the group.

```ts
describe('parse', () => {
  test('a circle', () => {
    assert.equal(parse('c')?.kind, 'circle')
  })
})
```

```ts
describe(name: string, fn: () => void): void;
describe(name: string, options: TestOptions, fn: () => void): void;
```

### `env`

Sets environment variables, or deletes them with `undefined`.
The old values come back when the test ends.

```ts
env({ NODE_ENV: 'production', DEBUG: undefined })
```

```ts
const env: (vars: Record<string, string | undefined>) => void;
```

### `fakeClock`

Replaces the timers and the clocks of the process with a clock
that moves only when the test moves it. The real ones come back
when the test ends, or at `clock.restore()`.

```ts
const clock = fakeClock()
const done = spy()
setTimeout(done, 1000)
await clock.tick(1000)
assert.equal(done.calls.length, 1)
```

```ts
const fakeClock: (options?: FakeClockOptions) => FakeClock;
```

### `isDeepEqual`

True if the two values are deeply equal, by the rules of
`assert.deepEqual`: the same structure, values, and prototypes.
It is not an assertion. Use it for a condition that
`assert.deepEqual` cannot state, such as "the list has an element
that equals this": `assert(list.some(item => isDeepEqual(item,
expected)))`. If that assertion fails, the report shows the values
of each call.

```ts
const isDeepEqual: (a: unknown, b: unknown) => boolean;
```

### `isMatch`

True if `actual` has the shape of `pattern`, by the rules of
`assert.match`. It is not an assertion. Use it for a condition
that `assert.match` cannot state, such as "a call of the spy has
arguments of this shape": `assert(s.calls.some(call =>
isMatch(call.args, [{ id: 7 }])))`. If that assertion fails, the
report shows the values of each call.

```ts
const isMatch: <T, const P extends Pattern<T> = Pattern<T>>(actual: T, pattern: P & Checked<P>) => boolean;
```

### `isMatchOnly`

True if `actual` has the shape of `pattern` and no other keys, by
the rules of `assert.matchOnly`. It is not an assertion. Use it as
`isMatch`: `assert(s.calls.some(call => isMatchOnly(call.args,
[{ id: 7 }])))`.

```ts
const isMatchOnly: <T, const P extends Pattern<T> = Pattern<T>>(actual: T, pattern: P & Checked<P>) => boolean;
```

### `mockImport`

Loads a new instance of a module. In that instance, and in the
project modules that it imports, each dependency in `mocks` is
replaced by the given exports.

```ts
const { greet } = await mockImport(() => import('../src/greet.ts'), [
  [() => import('../src/db.ts'), { fetchUser }],
])
```

```ts
const mockImport: <M, const D extends readonly unknown[]>(subject: Loader<M>, mocks: { [K in keyof D]: readonly [Loader<D[K]>, MockOf<D[K]>]; }) => Promise<M>;
```

### `spy`

#### `spy()`

A function that records each call in `calls`, and then calls
`impl`. With no `impl`, it takes any arguments and returns
`undefined`.

```ts
const send = spy((to: string) => to.length)
notify(send)
assert.equal(send.calls.length, 1)
assert.deepEqual(send.calls[0]?.args, ['ann'])
```

For a result that changes, the function reads a variable:
`let result = 1; const s = spy(() => result)`.

```ts
spy<F extends AnyFn = AnyFn>(impl?: F): Spy<F>;
```

#### `spy.results`

A spy with a list of results: call 1 gives the first one, call
2 the second one. A result that is an Error instance is
thrown. A call after the last result throws.

```ts
const read = spy.results('a', 'b', new Error('no more'))
assert.equal(read(), 'a')
assert.equal(read(), 'b')
assert.throws(() => read(), /no more/)
```

For an async function, the results are promises. A promise
that is rejected in the list is not an unhandled rejection.

```ts
const load = spy.results(Promise.resolve(user), Promise.reject(new Error('gone')))
```

```ts
spy.results<R>(...results: (R | Error)[]): Spy<(...args: any[]) => R>;
```

### `spyOn`

Replaces the method `key` of `object` with a spy. The spy calls
`impl`, or the original method. The original comes back when the
test ends. A second `spyOn` on the same key replaces the first.

```ts
const log = spyOn(console, 'log', () => {})
greet('ann')
assert.deepEqual(log.calls[0]?.args, ['hello, ann'])
```

```ts
const spyOn: <T extends object, K extends MethodKeys<T>>(object: T, key: K, impl?: T[K]) => Spy<T[K] & AnyFn>;
```

### `stub`

Sets `object[key]` to `value`. The old property comes back when
the test ends: its value or its getter, or no property if the
object had none of its own. For a function, `spyOn` also records
the calls. The value `undefined` fits each key: it is the form
for code that tests if a global is there.

```ts
stub(globalThis, 'navigator', { userAgent: 'test' })
stub(globalThis, 'performance', undefined)
```

```ts
const stub: <T extends object, K extends PropertyKey>(object: T, key: K, value: K extends keyof T ? T[K] | undefined : unknown) => void;
```

### `test`

Defines a test. The tests of a file run one at a time, in the
order of the file, after the file loaded. A test passes if its
function ends, or its promise resolves, with no failed assertion
and no error. It must run one assertion or more.

```ts
test('adds two numbers', () => {
  assert.equal(add(1, 2), 3)
})
test('loads the user', { timeout: 10_000 }, async ({ signal }) => {
  assert.match(await load('ann', { signal }), { name: 'Ann' })
})
test('reads the log', { skip: !hasGit && 'git is not installed' }, () => {
  assert.contains(log(), 'first commit')
})
```

ubq has no hooks, no `test.only`, and no `test.each`. Call a
setup function in the test, select a test on the command line
(`ubq <file>:<line>`), and call `test` in a loop.

```ts
test(name: string, fn: TestFn): void;
test(name: string, options: TestOptions, fn: TestFn): void;
```

#### Names that `test` does not have

Each of these names is a compile error, with the name to use in its place.

| Name | Use |
| --- | --- |
| `test.each` | Use a for loop around test() |
| `test.only` | ubq has no .only. Select tests on the command line: ubq \<file>:\<line> |
| `test.skip` | Use test(name, { skip: "reason" }, fn) |
| `test.todo` | Use test(name, { skip: "todo: reason" }, fn) |

### `testdir`

Makes a new folder with `files` in it and returns its path:
`.ubq/testdir/<test file>/<test name>`. The folder is removed
when the test ends. If the test fails, the folder stays.

```ts
const dir = testdir({ 'package.json': '{}', src: { 'a.ts': 'export {}' } })
assert.deepEqual(list(dir), ['package.json', 'src/a.ts'])
```

```ts
const testdir: (files?: Files) => string;
```

## `ubqtest/browser`

Import from `'ubqtest/browser'`.

### `browser`

Import from `'ubqtest/browser'`. The project needs the
`playwright-core` package, and `ubq browser install`.

A new page of a browser (Chromium), as a `Page` of Playwright. Use
the API of Playwright for all work with the page. The page closes
when the test ends. An error that the page does not catch fails
the test.

`page.goto('/a/page.html')` loads a file of the project, from the
project root. If the configuration has `browser.url`, the path is
from that URL.

`options` are the options of `browser.newContext` of Playwright,
such as `viewport` or `locale`.

```ts
const browser: (options?: BrowserContextOptions) => Promise<Page>;
```

### `prepareContext`

Import from `'ubqtest/browser'`.

Makes a browser context that the test started itself, with the
Playwright of the project, ready for a test of ubq. A function
that the test gives to `page.evaluate` has the coverage counters
of the test file in its text. In a page of this context, they
count into an object that keeps nothing. With no call, such a
function throws `ReferenceError: __ubqc is not defined`.

A page of `browser()` needs no call.

```ts
const context = await chromium.launch().then(b => b.newContext())
await prepareContext(context)
```

```ts
const prepareContext: (context: {
    addInitScript(script: string): Promise<unknown>;
}) => Promise<void>;
```

## `ubqtest/workers`

Import from `'ubqtest/workers'`.

### `executionContext`

Makes the third argument of a handler: `worker.fetch(request,
env, ctx)`. `await ctx.settled()` waits for the promises that
the handler gave to `ctx.waitUntil`. The test also waits for
them when it ends.

```ts
const executionContext: () => ExecutionContext & {
    settled(): Promise<void>;
};
```

### `migrate`

Applies the migrations of a D1 database to its local copy.
`binding` is the name of the database in the wrangler config,
such as `'DB'`. The files come from its `migrations_dir`.

```ts
const migrate: (binding: string) => Promise<void>;
```

### `scheduledController`

Makes the first argument of a `scheduled` handler.

```ts
const scheduledController: (options?: {
    scheduledTime?: number;
    cron?: string;
}) => ScheduledController;
```

## Types

The types that the package exports.

### `Assert`

The type of [`assert`](#assert). Its members are in that part.

### `FakeClock`

The clock that `fakeClock()` returns.

#### `FakeClock[Symbol.dispose]`

The same as `restore()`, for `using clock = fakeClock()`.

```ts
[Symbol.dispose](): void;
```

#### `FakeClock.now`

The time of the clock, in milliseconds since 1970.

```ts
readonly now: number;
```

#### `FakeClock.restore`

Puts the real timers and clocks back. The end of the test does this too.

```ts
restore(): void;
```

#### `FakeClock.runAll`

Moves the clock from timer to timer until no timer waits.

```ts
runAll(): Promise<void>;
```

#### `FakeClock.set`

Sets the time of `Date`, forward or back, and runs no timer.
`performance.now()`, `process.hrtime()`, and the timers do not
change: a timer runs after the same count of milliseconds.

```ts
set(time: number | Date): void;
```

#### `FakeClock.tick`

Moves the clock forward by `ms`. Each timer that is due runs, in
the order of its time. Promise callbacks run after each timer.
`tick(0)` runs only the `setImmediate` callbacks.

```ts
tick(ms: number): Promise<void>;
```

#### `FakeClock.timers`

The count of timers that wait.

```ts
readonly timers: number;
```

### `FakeClockOptions`

The options of `fakeClock`.

#### `FakeClockOptions.now`

The time at the start. The default is the real time.

```ts
now?: number | Date;
```

### `Files`

File names with their content. A nested object is a folder.

```ts
interface Files {
    [name: string]: string | Uint8Array | Files;
}
```

### `MockOf`

The exports that replace a module. Each one must have the type of
the real export. For a function with overloads, a function that
fits the last overload is correct too.

```ts
type MockOf<T> = {
    [K in keyof T]?: T[K] extends AnyFn ? T[K] | ((...args: Parameters<T[K]>) => ReturnType<T[K]>) : T[K];
};
```

### `Pattern`

A partial shape: listed keys must match, a RegExp tests a string,
and a function is a predicate for the value at its place.

```ts
type Pattern<T> = Prim<Exclude<T, object>> | Obj<Extract<T, object>> | Predicate;
```

### `Spy`

A function that records each call in `calls`. It has the type of the
function that it replaces.

```ts
type Spy<F extends AnyFn = AnyFn> = F & {
    calls: SpyCall<F>[];
};
```

### `SpyCall`

One call of a spy: its arguments, and its result. `error` is present,
and `result` is not, if the call threw. `this` is the `this` value
of the call. It is not enumerable: `assert.deepEqual` of a call
with `{ args, result }` does not see it. `args` is `unknown[]`: the
code under test can pass more arguments, or different ones, than the
type of the function has. An expected value of each type compares
with it. To read a property of an argument, test its type first.

```ts
interface SpyCall<F extends AnyFn> {
    args: unknown[];
    result?: ReturnType<F>;
    error?: unknown;
    readonly this?: unknown;
}
```

### `SpyFunction`

The type of [`spy`](#spy). Its members are in that part.

### `TestContext`

The argument of a test function.

#### `TestContext.signal`

Aborts when the test times out.

```ts
readonly signal: AbortSignal;
```

#### `TestContext.skip`

Ends the test as skipped, with the reason. For a condition
that the test knows only while it runs. A condition that is
known before is the `skip` option. A test that has a failure
at this point is a failure.

```ts
test('wraps long lines', async ({ skip }) => {
  const lines = await measure(page)
  if (lines < 3) skip('the page has no paragraph of three lines')
  assert.lessThan(width(page), 80)
})
```

```ts
skip(reason: string): never;
```

### `TestFn`

The function of a test. It can return a promise.

```ts
type TestFn = (ctx: TestContext) => void | Promise<void>;
```

### `TestOptions`

The options of `test` and of `describe`. A group gives its options to
its tests.

#### `TestOptions.skip`

The reason to skip the test. `false` runs the test.

```ts
skip?: string | false;
```

#### `TestOptions.timeout`

The time limit of the test in milliseconds. The default is 5000, or
the `timeout` of the configuration.

```ts
timeout?: number;
```

## Types of the signatures

The package does not export these types. The signatures above
use them, so a reader needs them.

### `AnyFn`

A function with any arguments and any result.

```ts
type AnyFn = (...args: any[]) => any;
```

### `Arr`

The pattern of each array type of a union. A tuple has a pattern
for each place. An array of any length has one pattern type for
its elements, as an array type: the type can then have itself in
it, as a JSON type does.

```ts
type Arr<A> = A extends readonly unknown[] ? number extends A['length'] ? PatternList<A[number]> : {
    [K in keyof A]: Pattern<A[K]>;
} : never;
```

### `Checked`

The pattern `P`, with a function that is not a predicate made a
compile error. This check does not use the type of the value, so
it works for a value of type `unknown` too. It goes into arrays,
and into objects where each key is readonly: an object literal in
the call is such an object, and a `Date` or a `Map` is not.

```ts
type Checked<P> = P extends (...args: never[]) => unknown ? P extends Predicate ? P : Hint<'A function in a pattern must be (value: unknown) => boolean. To compare a function as a value, use assert.equal'> : P extends readonly unknown[] ? {
    [K in keyof P]: Checked<P[K]>;
} : P extends object ? Same<P, Readonly<P>> extends true ? {
    [K in keyof P]: Checked<P[K]>;
} : P : P;
```

### `CheckedError`

At the top level, a RegExp or a class is not a pattern.

```ts
type CheckedError<P> = P extends RegExp | (abstract new (...args: any[]) => unknown) ? unknown : Checked<P>;
```

### `CleanupFn`

The function of `cleanup`. `limit` is a time limit in milliseconds, in
place of the default one.

```ts
type CleanupFn = (() => void | Promise<void>) & {
    limit?: number;
};
```

### `Describe`

The type of [`describe`](#describe). Its members are in that part.

### `ErrorMatch`

What `assert.throws` and `assert.rejects` compare an error with: a
RegExp for the message, a class, or a `match` pattern.

```ts
type ErrorMatch = RegExp | (abstract new (...args: any[]) => unknown) | Record<string, unknown>;
```

### `Hint`

A property that cannot be called. The compile error prints this
type, so the type parameter is the text of the fix.

```ts
type Hint<S extends string> = {
    readonly [K in S]: never;
};
```

### `Keyed`

```ts
type Keyed<O> = [O] extends [never] ? never : {
    [K in Keys<O>]?: Pattern<Val<O, K>>;
};
```

### `Keys`

The keys of each member of a union.

```ts
type Keys<T> = T extends unknown ? keyof T : never;
```

### `Loader`

A function that imports a module: `() => import('../src/a.ts')`.

```ts
type Loader<M> = () => Promise<M>;
```

### `MethodKeys`

The keys of `T` whose values are functions.

```ts
type MethodKeys<T> = {
    [K in keyof T]-?: T[K] extends AnyFn ? K : never;
}[keyof T];
```

### `Obj`

The pattern of the objects of a type. An array has a pattern for
each element. For the other objects, each key is optional, and a
key of each member of a union is a key of the pattern.

```ts
type Obj<O> = Arr<Extract<O, readonly unknown[]>> | Keyed<Exclude<O, readonly unknown[]>>;
```

### `PatternList`

An interface: the checker reads it only when it needs it.

```ts
interface PatternList<E> extends ReadonlyArray<Pattern<E>> {
}
```

### `Predicate`

A function in a pattern: it tests the value at its place.

```ts
type Predicate = (value: unknown) => boolean;
```

### `Prim`

The pattern of a value that is not an object: the value, or a RegExp for
a string.

```ts
type Prim<T> = T extends string ? T | RegExp : T;
```

### `Same`

True if `A` and `B` are the same type.

```ts
type Same<A, B> = (<V>() => V extends A ? 1 : 2) extends <V>() => (V extends B ? 1 : 2) ? true : false;
```

### `Test`

The type of [`test`](#test). Its members are in that part.

### `Val`

The type of the key `K` in the members of a union that have it.

```ts
type Val<T, K> = T extends unknown ? (K extends keyof T ? T[K] : never) : never;
```
