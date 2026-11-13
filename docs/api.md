# ubqtest API

Each export of the `ubqtest` package, with its type and its doc
comment. `npm run docs` makes this file from the type
declarations of the built package. Do not change it by hand. A
test fails if it is not current.

For how to use the API, with examples and the rules of a test,
read [GUIDE.md](../GUIDE.md) (`ubq guide`).

## Functions

### `assert`

```ts
const assert: Assert;
```

### `isDeepEqual`

True if the two values are deeply equal, by the rules of
`assert.deepEqual`: the same structure, values, and prototypes.
It is not an assertion. Use it for a condition that
`assert.deepEqual` cannot state, such as "the list has an element
that equals this": `assert(list.some(item => isDeepEqual(item,
expected)))`.

```ts
const isDeepEqual: (a: unknown, b: unknown) => boolean;
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

### `cleanup`

Runs `fn` when the test ends. Outside a test: when the file ends.
The functions run in reverse order. An error in one fails the test.

```ts
const cleanup: (fn: CleanupFn) => void;
```

### `env`

Sets environment variables, or deletes them with `undefined`.
The old values come back when the test ends.

```ts
const env: (vars: Record<string, string | undefined>) => void;
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
const mockImport: <M, const D extends readonly unknown[]>(subject: Loader<M>, mocks: { [K in keyof D]: [Loader<D[K]>, MockOf<D[K]>]; }) => Promise<M>;
```

### `spy`

A function that records each call in `calls`, and then calls `impl`.

```ts
const spy: <F extends AnyFn = (...args: unknown[]) => void>(impl?: F) => Spy<F>;
```

### `spyOn`

Replaces the method `key` of `object` with a spy. The spy calls
`impl`, or the original method. The original comes back when the
test ends.

```ts
const spyOn: <T extends object, K extends MethodKeys<T>>(object: T, key: K, impl?: T[K]) => Spy<T[K] & AnyFn>;
```

### `describe`

```ts
const describe: Describe;
```

### `test`

```ts
const test: Test;
```

### `testdir`

Makes a new folder with `files` in it and returns its path:
`.ubq/testdir/<test file>/<test name>`. The folder is removed
when the test ends. If the test fails, the folder stays.

```ts
const testdir: (files?: Files) => string;
```

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

### `scheduledController`

Makes the first argument of a `scheduled` handler.

```ts
const scheduledController: (options?: {
    scheduledTime?: number;
    cron?: string;
}) => ScheduledController;
```

### `migrate`

Applies the migrations of a D1 database to its local copy.
`binding` is the name of the database in the wrangler config,
such as `'DB'`. The files come from its `migrations_dir`.

```ts
const migrate: (binding: string) => Promise<void>;
```

## Types

### `Assert`

```ts
interface Assert {
    /** Passes if `value` is truthy. Narrows the type of `value`. */
    (value: unknown, message?: string): asserts value;
    /** Passes if `Object.is(actual, expected)`. Narrows the type of `actual`. */
    equal<T, const E extends T>(actual: T, expected: E, message?: string): asserts actual is E;
    /** Passes if not `Object.is(actual, expected)`. */
    notEqual<T>(actual: T, expected: NoInfer<T>, message?: string): void;
    /** Passes if both have the same structure, values, and prototypes. */
    deepEqual<T>(actual: T, expected: NoInfer<T>, message?: string): void;
    /**
     * Passes if `actual` has the shape of `pattern`. Each key in the
     * pattern must match. Extra keys in `actual` are fine. A RegExp
     * tests a string.
     */
    match<T, const P extends Pattern<T>>(actual: T, pattern: P, message?: string): void;
    /**
     * Passes if `fn` throws an error that fits `expected`: a RegExp
     * tests the message, a class tests `instanceof`, an object is a
     * `match` pattern. Returns the error.
     */
    throws(fn: () => unknown, expected: ErrorMatch, message?: string): Error;
    /** As `throws`, for a promise. The result must be awaited. */
    rejects(promise: Promise<unknown> | (() => Promise<unknown>), expected: ErrorMatch, message?: string): Promise<Error>;
    /**
     * As `match`, for a value that changes with time, such as the text
     * of a page. Calls `fn` again and again until its value matches
     * `pattern`. Fails after 2000 ms with the last value. The result
     * must be awaited.
     */
    eventually<T, const P extends Pattern<Awaited<T>>>(fn: () => T, pattern: P, message?: string): Promise<void>;
    /**
     * Passes if the text of `value` is the text in the snapshot file
     * of the test file. `ubq --update <test>` writes the file.
     */
    snapshot(value: unknown, message?: string): void;
    /** Fails the test. */
    fail(message: string): never;
    toMatchSnapshot: Hint<'Use assert.snapshot(value)'>;
    matchSnapshot: Hint<'Use assert.snapshot(value)'>;
    ok: Hint<'Use assert(value)'>;
    strictEqual: Hint<'Use assert.equal (it is always strict)'>;
    deepStrictEqual: Hint<'Use assert.deepEqual (it is always strict)'>;
}
```

### `Pattern`

A partial shape: listed keys must match, and a RegExp tests a string.

```ts
type Pattern<T> = Prim<Exclude<T, object>> | Obj<Extract<T, object>>;
```

### `FakeClock`

```ts
interface FakeClock {
    /** The time of the clock, in milliseconds since 1970. */
    readonly now: number;
    /** The count of timers that wait. */
    readonly timers: number;
    /**
     * Moves the clock forward by `ms`. Each timer that is due runs, in
     * the order of its time. Promise callbacks run after each timer.
     */
    tick(ms: number): Promise<void>;
    /** Moves the clock from timer to timer until no timer waits. */
    runAll(): Promise<void>;
    /** Puts the real timers and clocks back. The end of the test does this too. */
    restore(): void;
    [Symbol.dispose](): void;
}
```

### `FakeClockOptions`

```ts
interface FakeClockOptions {
    /** The time at the start. The default is the real time. */
    now?: number | Date;
}
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

### `Spy`

A function that records each call.

```ts
type Spy<F extends AnyFn = AnyFn> = F & {
    calls: SpyCall<F>[];
};
```

### `SpyCall`

One call of a spy. `error` is present if the call threw.

```ts
interface SpyCall<F extends AnyFn> {
    args: Parameters<F>;
    result?: ReturnType<F>;
    error?: unknown;
}
```

### `TestContext`

```ts
interface TestContext {
    /** Aborts when the test times out. */
    readonly signal: AbortSignal;
}
```

### `TestFn`

```ts
type TestFn = (ctx: TestContext) => void | Promise<void>;
```

### `TestOptions`

```ts
interface TestOptions {
    /** The reason to skip the test. `false` runs the test. */
    skip?: string | false;
    /** Milliseconds. The default is 5000. */
    timeout?: number;
}
```
