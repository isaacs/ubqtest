# Test API

The API for test files. Status: the user accepted it on 2026-11-11
(D15 to D18 in `02-decisions.md`).

The type sketch is in `experiments/api/ubq.ts`. `good.ts` there
compiles, and each line of `bad.ts` gives the compile error that
this document claims. `mock-rt.ts` proves the mock call at run time
on Node and Deno.

Not in this document: the CLI, the config, the fake clock, and
snapshots. Each one gets its own document.

## 1. A full example

```ts
import { test, describe, assert, spy, testdir, mockImport } from 'ubqtest'
import { parse } from '../src/parse.ts'

describe('parse', () => {
  test('circle', () => {
    const shape = parse('c')
    assert(shape)                       // narrows away undefined
    assert.equal(shape.kind, 'circle')  // narrows the union
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
4. **Types carry the rules.** An assertion narrows the type of its
   argument. A mock must match the module that it replaces. A
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
  runs single tests by ID, and a later step adds random order with
  a seed.
- `name` must be unique in its `describe` group. A duplicate is an
  error, because the name is part of the test ID
  (`test/parse.ts > parse > circle`).
- `timeout` is in milliseconds. The default is 5000, the same as
  Vitest and Jest.
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
assert.equal(actual, expected, message?)       // asserts actual is typeof expected
assert.notEqual(actual, expected, message?)
assert.deepEqual(actual, expected, message?)
assert.match(actual, pattern, message?)
assert.throws(fn, expected, message?)          // returns the Error
await assert.rejects(promise, expected, message?)  // resolves to the Error
assert.fail(message)                           // returns never
```

| Function | Passes when |
| --- | --- |
| `assert(value)` | `value` is truthy. Use it to narrow: `assert(user)`, `assert(err instanceof HttpError)`. |
| `equal` | `Object.is(actual, expected)`. |
| `notEqual` | not `Object.is(actual, expected)`. |
| `deepEqual` | same structure, same values, same prototypes. The rules of `assert.deepStrictEqual` in Node. |
| `match` | `actual` has the shape of `pattern`. See below. |
| `throws` | `fn` throws an error that fits `expected`. |
| `rejects` | the promise (or the promise that the function returns) rejects with an error that fits `expected`. |

**`match` patterns.** One function covers "looks like this":

- A `RegExp` matches a string that it tests true for.
- An object matches if each key in the pattern matches the same
  key in the value. Extra keys in the value are fine.
- An array matches an array of the same length, element by
  element.
- Any other value matches by `Object.is`.

```ts
assert.match(res, { status: 200, body: { user: { name: /^a/ } } })
```

This keeps expected values short when the full object is large.

**`expected` in `throws` and `rejects`** is required. A test that
accepts any error also accepts a typing mistake in the code under
test.

- A `RegExp` tests the message.
- A class tests `instanceof`.
- An object is a `match` pattern for the error.

Both return the error, so more assertions can follow:

```ts
const err = assert.throws(() => parse('?'), ParseError)
assert.equal(err.message, 'unknown shape: ?')
```

**`rejects` must be awaited.** If the test ends and nothing awaited
the result, the test fails with a message that says so.

**Types.**

- `assert(value)` and `assert.equal` narrow, as the example shows.
  This works because `assert` is an import with a declared type.
  It would not work for a method of a context argument (TypeScript
  requires an explicit type on the receiver of an assertion
  function). That is the reason assertions are not on a `t` object.
- `expected` must be assignable to the type of `actual`.
  `assert.equal(count, '1')` does not compile when `count` is a
  number.

Assertions find the current test through `AsyncLocalStorage`, which
has no measurable cost (`03-measurements.md`, section 8). An
assertion that runs after its test ended fails that test.

## 6. Mocks and spies

### `spy`, `spyOn`

```ts
spy<F>(impl?: F): Spy<F>
spyOn(object, key, impl?): Spy<typeof object[key]>
```

- A spy is a function that records each call in `spy.calls`, as
  `{ args, result, error }`.
- `spyOn` replaces a method and puts the original back when the
  test ends.
- There are no special assertions for spies. Use `assert.equal`
  and `assert.deepEqual` on `calls`.
- With no `impl`, `spy()` returns `undefined`, and `spyOn` calls
  the original method. `result` of an async function is its
  promise. `error` is present only if the call threw.
- The key of `spyOn` must name a function of the object. A
  different key is a compile error.

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

Proven on Node and Deno. Bun needs a different hook (`Bun.plugin`),
not tested yet.

## 7. Fixtures and cleanup

A fixture is a function that a test calls. It sets something up
and removes it when the test ends. The test does not have to ask
for the removal.

```ts
testdir(files?: Files): string     // a new folder, removed at test end
env(vars: Record<string, string | undefined>): void   // set or delete, put back at test end
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
| `test.skip`, `test.todo` | `Use test(name, { skip: "reason" }, fn)` |
| `test.only` | `ubq has no .only. Select tests on the command line: ubq <file>:<line>` |
| `test.each` | `Use a for loop around test()` |
| `assert.ok` | `Use assert(value)` |
| `assert.strictEqual` | `Use assert.equal (it is always strict)` |
| `assert.deepStrictEqual` | `Use assert.deepEqual (it is always strict)` |

`it`, `expect`, and the hook names are not exports. An import of
one fails with the normal "no exported member" error. The agent
guide in the package lists the replacement for each.

## 10. Where each part comes from

| Part | Source | Change |
| --- | --- | --- |
| `test(name, options, fn)`, `describe` | Vitest, `node:test` | no hooks, no modifiers |
| `assert.equal`, `deepEqual`, `throws`, `rejects`, `match`, `fail` | `node:assert/strict` | `expected` is required for `throws` and `rejects`, and both return the error |
| `match` with object patterns | tap `t.match` | no constructor patterns |
| `testdir(files)` | tap `t.testdir` | a free function |
| `mockImport` | tap `t.mockImport` | paths and types come from `import()` expressions |
| `spy`, `spyOn` | Vitest `vi.fn`, `vi.spyOn` | calls are plain records, no special assertions |
| `{ signal }` | Vitest, `node:test` | |
| 5000 ms timeout | Vitest, Jest | |

## 11. Open points

- **`match` patterns have no type matchers** (tap permits
  `{ id: Number }`). Add them only if tests need them often.
- **Fake clock and snapshots** are in build step 7 and need their
  own design.
