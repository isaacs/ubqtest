# ubq guide

How to write and run tests with `ubqtest`. This text comes from
the installed package, so it is correct for the installed version.
`ubq guide` prints it. `ubq doctor` checks the setup of a project:
it prints one `FIX` line for each problem, and its exit code is 1
if there is a problem.

## A test file

```ts
// test/parse.test.ts
import { assert, describe, test } from 'ubqtest'
import { parse } from '../src/parse.ts'

describe('parse', () => {
  test('circle', () => {
    const shape = parse('c')
    assert(shape) // narrows away undefined
    assert.equal(shape.kind, 'circle')
  })

  test('unknown input', () => {
    assert.throws(() => parse('?'), /unknown shape/)
  })

  for (const [input, kind] of [['c', 'circle'], ['s', 'square']] as const)
    test(`kind of ${input}`, () => {
      assert.match(parse(input), { kind })
    })
})
```

- The name of a test file ends in `.test.ts` (or `.test.js`,
  `.test.mts`, `.test.tsx`, and so on). The file can be in any
  folder of the project.
- Import each function from `'ubqtest'`. There are no globals.
- Import source files with their extension: `'../src/parse.ts'`.
- A test file needs no build step and no configuration.

## Run

```
ubq                      all test files of the project
ubq test/parse.test.ts   one file (or a folder)
ubq test/parse.test.ts:9 the test at that line
ubq '<test id>'          one test, or the tests of a group
ubq --failed             the tests that failed in their last run
ubq --changed            the test files that loaded a file that changed
node test/parse.test.ts  a test file is a plain program (also: deno run -A, bun)
```

Each run also runs the type checker, if the project has
`tsconfig.json` and the `typescript` package. Each type error is a
`TYPE` block, and the run fails. The tests run in any case.

Use `npx ubq` if `ubq` is not on the path. On Bun: `bun
node_modules/.bin/ubq`.

The last line of the output is the summary: `pass: 0 failed, 12
passed (run 7)` or `fail: 2 failed, 10 passed (run 8)`. Passed
tests print nothing.

Exit codes: 0 pass, 1 failure, 2 no tests ran, 4 wrong command or
configuration.

A failure block has the test ID, the message, the location, the
source line, the difference, and the command that runs the test
again:

```
FAIL test/parse.test.ts > parse > circle
  expected values to be equal
  at test/parse.test.ts:9:12
  > assert.equal(shape.kind, 'circle')
  actual:   'square'
  expected: 'circle'
  rerun: ubq test/parse.test.ts:6
```

## Rules that fail a test

- A test with zero assertions fails. There is no opt-out.
- `assert.rejects` with no `await` fails.
- An assertion, a timer callback, or a promise of a test that runs
  after the test ended fails that test.
- A test that changes `process.env` or the working directory and
  does not put the change back fails. Use `env()` and `cleanup()`.
- A test that takes more than its time limit fails (default 5000
  ms). The message lists what the test left open. Then ubq runs
  that test one more time, and a `HANG` block names the line that
  opened each thing: `Timeout opened at test/a.test.ts:18:32`.
- Two tests with the same name in one group are an error.
- A call to `process.exit` in a test file is an error.

Do not weaken a test to get a pass. Each of these rules catches a
test that would pass for the wrong reason.

## API

```ts
test(name, fn)
test(name, { skip?: string | false, timeout?: number }, fn)
describe(name, fn)                 // a name prefix for its tests. fn is sync.
describe(name, { skip?, timeout? }, fn)

assert(value, message?)            // truthy. Narrows the type.
assert.equal(actual, expected)     // Object.is
assert.notEqual(actual, expected)
assert.deepEqual(actual, expected) // strict: same structure, values, prototypes
assert.match(actual, pattern)      // RegExp for a string, or a partial object
assert.throws(fn, expected)        // expected is required. Returns the error.
await assert.rejects(promise, expected)   // resolves to the error
assert.snapshot(value)             // compares with saved text
assert.fail(message)

spy(impl?)                         // records calls in spy.calls: { args, result, error }
spyOn(object, key, impl?)          // replaces a method until the test ends
await mockImport(() => import('../src/a.ts'), [
  [() => import('../src/dep.ts'), { fn: replacement }],
])                                 // a new instance of a.ts with a mocked dep.ts

testdir({ 'a.txt': 'hi', sub: { 'b.json': '{}' } })  // a new folder, returns its path
env({ NAME: 'value', OTHER: undefined })             // set or delete, until the test ends
cleanup(() => server.close())                        // runs when the test ends
const clock = fakeClock({ now: 0 })                  // await clock.tick(ms), await clock.runAll()
```

- `expected` of `throws` and `rejects` is a `RegExp` for the
  message, an error class, or a partial object.
- An object pattern of `match` permits extra keys in the value. An
  array pattern must have the same length.
- The test function gets `{ signal }`. The signal aborts at the
  time limit. Pass it to `fetch` and to child processes.
- `skip` is the reason, as text: `{ skip: 'needs a GPU' }`. A
  condition: `{ skip: process.platform === 'win32' && 'needs fork' }`.
- Tests of a file run one at a time, in the order of the file.
  Test files run in parallel, each in its own process, in a random
  order. A run with a failure prints the seed. `ubq --seed <n>`
  repeats the order.
- For shared setup, write a function and call it in each test.
  `testdir`, `env`, `cleanup`, and `spyOn` at the top level of a
  file (before the first `test`) last until the file ends.
- A failed test keeps its `testdir` folder, and the failure block
  prints the path.
- The mock of `mockImport` must have the types of the real
  exports. It exists only in the returned module instance. The
  two loaders must have the form `() => import('...')`. A mock
  with a spy:

  ```ts
  test('checkout charges the card', async () => {
    const charge = spy(async (card: string, cents: number) => ({ id: 'r1', cents }))
    const { checkout } = await mockImport(() => import('../src/cart.ts'), [
      [() => import('../src/payment.ts'), { charge }],
    ])
    await checkout(items, 'card-1')
    assert.deepEqual(charge.calls[0]?.args, ['card-1', 700])
  })
  ```
- Snapshots are in `ubq-snapshots/`. Commit them. A value with no
  saved text fails. Only `ubq --update <file or test id>` writes
  them. Read the new text before you commit it.

## Names that do not exist

| Do not use | Use |
| --- | --- |
| `it` | `test` |
| `expect(x).toBe(y)`, `toEqual` | `assert.equal(x, y)`, `assert.deepEqual(x, y)` |
| `assert.ok`, `strictEqual`, `deepStrictEqual` | `assert(value)`, `assert.equal`, `assert.deepEqual` |
| `beforeEach`, `afterEach`, `beforeAll`, `afterAll` | a setup function, `cleanup`, top-level code |
| `test.only`, `describe.only` | `ubq <file>:<line>` or `ubq '<test id>'` |
| `test.skip`, `test.todo`, `skipIf` | `test(name, { skip: 'reason' }, fn)` |
| `test.each` | a `for` loop around `test()` |
| `retry` | none. `ubq --repeat <n>` counts the failures of a flaky test. |
| `vi.mock`, `jest.mock` | `mockImport` |
| `vi.fn`, `jest.fn` | `spy` |
| `vi.useFakeTimers` | `fakeClock` |
| `toMatchSnapshot` | `assert.snapshot(value)` |
| `assert.doesNotThrow` | call the function, then assert on its result |
| a subtest in a test, `t.plan`, `t.end` | `describe`. A test ends when its function ends. |

## Questions about stored runs

Each run is stored in `.ubq/runs.db` (git ignores `.ubq/`). These
commands read the store and run no test:

```
ubq failures [run]        the failures of a run again (default: the last run)
ubq show '<test id>'      the last result of a test, with its console output
ubq history '<test id>'   the result of a test in each stored run. Says if the test is flaky.
ubq diff [run] [run]      the tests whose status differs in two runs
ubq slow [run]            the slowest tests
ubq uncovered [file]      code that no test ran
ubq covers <file>:<line>  the tests that ran a line
ubq sql '<query>'         a read-only SQL query, as JSON lines
```

Coverage is always on, for each test. After a change to a source
file, `ubq --changed` runs only the test files that loaded it.
Before a change to a line, `ubq covers <file>:<line>` names the
tests that protect it.

A mutation check tells if the tests of a file are strong:

```
ubq mutate src/cart.ts       makes small changes to the file, one at a time, and runs the tests of the changed code
ubq mutate src/cart.ts:20    only the changes on that line
```

It changes an operator, a number, or a boolean (`-` to `+`, `<` to
`<=`, `0` to `1`), in the test processes only. The file does not
change. Each `SURVIVED` block is a change that no test failed for:
add a test for that case. Some changes cannot make a test fail,
because the changed code does the same thing. Do not change
correct code for them. Run the tests before the check (`ubq`).

More run commands:

```
ubq --repeat <n> <selection>        run the tests n times, count the failures of each
ubq --baseline <commit> <selection> show only the failures that the git commit does not have
```

Console output of a test is captured. It shows only in the
failure block of its test, and in `ubq show`.

## Faster runs

`ubq server` starts a background server for the project. It keeps
test processes ready, so a run of a few files is about 30 ms
faster, and the first run after an edit about 45 ms. `--repeat`
is about 3 times faster. The commands,
the output, and the exit codes do not change. It stops after 30
minutes with no use, or with `ubq server stop`. It is optional.

## Configuration

Most projects need none. The `ubq` key of `package.json` can have
`include` and `exclude` (lists of glob patterns for test files),
`timeout` (milliseconds), and `hangRerun` (`false` turns off the
rerun of a test that timed out). A folder with its own `package.json`
is a different project: run `ubq` in that folder.

## Requirements

Node 24 or later, or Bun, or Deno. TypeScript runs with no build
step, so the code must use only syntax that can be erased: no
`enum`, no `namespace`, no parameter properties. In
`tsconfig.json`, set `"allowImportingTsExtensions": true`,
`"noEmit": true`, and `"erasableSyntaxOnly": true`.
