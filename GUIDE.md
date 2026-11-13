# ubq guide

How to write and run tests with `ubqtest`. This text comes from
the installed package, so it is correct for the installed version.
`ubq guide` prints it. `ubq guide convert` tells how to move a
project from a different test tool. `ubq doctor` checks the setup
of a project: it prints one `FIX` line for each problem, and its
exit code is 1 if there is a problem.

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
  Under `ubq`, `'../src/parse.js'` also finds `parse.ts`.
- A test file needs no build step and no configuration.

## Run

```
ubq                      all test files of the project
ubq test/parse.test.ts   one file (or a folder)
ubq test/parse.test.ts:9 the test at that line
ubq '<test id>'          one test, or the tests of a group
ubq --failed             the tests that failed in their last run
ubq --changed            the tests that ran code that changed
node test/parse.test.ts  a test file is a plain program (also: deno run -A, bun)
```

Each run also runs the type checker, if the project has
`tsconfig.json` and the `typescript` package. Each type error is a
`TYPE` block, and the run fails. The tests run in any case.

- A folder with its own `tsconfig.json` is checked too, if a test
  file of the run is in it.
- A run of all tests (`ubq`) reports each type error. A run of a
  selection (`ubq <file>`, `ubq --changed`) reports the type
  errors of the files that it used: its test files, and the
  files that their tests ran. It prints the count of the others
  in one line, and does not fail for them.

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
- `assert.rejects` or `assert.eventually` with no `await` fails.
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

[Complete API reference](/api)

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
await assert.eventually(fn, pattern)      // as match. Calls fn again until it matches, 2000 ms at most.
assert.snapshot(value)             // compares with saved text
assert.fail(message)
isDeepEqual(a, b)                  // true or false, by the rules of deepEqual. Not an assertion.

spy(impl?)                         // records calls in spy.calls: { args, result, error }
spyOn(object, key, impl?)          // replaces a method until the test ends. A second spyOn on the key replaces the first.
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
- The expected value of `equal` and `deepEqual` must have the type
  of the actual value. If the type checker refuses a comparison,
  make the value exact (`value!`, or narrow it with
  `assert(value)`). To compare two different types on purpose:
  `assert.deepEqual<unknown>(a, b)`.
- The test function gets `{ signal }`. The signal aborts at the
  time limit. Pass it to `fetch` and to child processes.
- `skip` is the reason, as text: `{ skip: 'needs a GPU' }`. A
  condition: `{ skip: process.platform === 'win32' && 'needs fork' }`.
- Tests of a file run one at a time, in the order of the file.
- `fakeClock` replaces the global timers and `Date`. On Node, it
  also replaces a name that a file imported from `node:timers` or
  `node:timers/promises`. On Bun and Deno, such a name keeps the
  real timer: use the global `setTimeout` there.
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
ubq uncovered [file]      code that no test ran, in each file that a test loaded. Not test files, and not test helpers. Exit code 1 if it lists code.
ubq uncovered --diff      code that no test ran, in the lines that you changed (from the last git commit)
ubq merge <store>...      adds the coverage of other stores: a project folder, a .ubq folder, or a runs.db file
ubq covers <file>:<line>  the tests that ran a line
ubq sql '<query>'         a read-only SQL query, as JSON lines
```

Coverage is always on, for each test. Before a change to a line,
`ubq covers <file>:<line>` names the tests that protect it.

After a change to the source, do these in order:

```
ubq --changed           runs only the tests that ran the code that changed
ubq uncovered --diff    lists the code that you changed and that no test runs: write a test for it
ubq mutate --diff       a mutation check of the lines that you changed (see below)
```

`--diff` is the difference from the last git commit, with files
that git does not have yet. `--diff=main` is the difference from
a different commit.

A mutation check tells if the tests of a file are strong:

```
ubq mutate src/cart.ts       makes small changes to the file, one at a time, and runs the tests of the changed code
ubq mutate src/cart.ts:20    only the changes on that line
ubq mutate --diff            only the lines that you changed
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

## Tests in a browser

For code that runs in a browser. The driver is Playwright, with
Chromium. Set up one time:

```
npm install --save-dev playwright-core
npx ubq browser install     downloads the browser, if it is not there
```

```ts
import { assert, test } from 'ubqtest'
import { browser } from 'ubqtest/browser'

test('the button counts', async () => {
  const page = await browser()           // a Page of Playwright, in a new context
  await page.goto('/test/pages/count.html')
  await page.click('#add')
  await assert.eventually(() => page.textContent('#total'), '1')
})
```

- `browser()` gives a `Page` of Playwright. Use the Playwright
  API for all work with the page: `goto`, `click`, `fill`,
  `locator`, `getByRole`, `evaluate`. There is no `expect`: read
  a value from the page and use `assert`.
- A page changes with time. For a value that is not there at
  once, use `await assert.eventually(() => value, pattern)`. Do
  not use a fixed wait.
- The page closes when the test ends. An error that the page
  does not catch fails the test.
- An action waits 2000 ms for its element. Then it fails, and the
  message names the element.
- The first `browser()` call of a file starts the browser. On a
  slow machine that takes seconds: give such a test a longer
  limit, `{ timeout: 30_000 }`.
- `browser(options)` takes the options of `browser.newContext`
  of Playwright, such as `viewport` and `locale`.

Coverage: the code of the project that a page runs is coverage of
the test, as the code that the test process runs. So `ubq
--changed`, `ubq uncovered`, and `ubq covers` work for it. This
needs a script whose URL path is the path of a project file. The
script is the file as it is, or a server made it from that one
file and put a source map at its end (Vite in development does
this). A bundle of many files has no coverage.

Which page `page.goto('/path')` loads:

- With no configuration: the file at that path from the project
  root. No server runs. The browser gets files as they are, so a
  page cannot load TypeScript: build first, or use a server.
- With `"ubq": { "browser": { "url": "http://localhost:5173" } }`
  in `package.json`: the path at that URL. Add `"command": "npm
  run dev"` and `ubq` starts the server for a run that has a
  browser test, if nothing answers at the URL, and stops it after
  the run. `node <test file>` does not start the server.
- A full URL always works: `page.goto('https://example.com')`.

A different browser version, or a shared download:

- The browser version comes from the version of `playwright-core`
  in the project.
- `PLAYWRIGHT_BROWSERS_PATH=<folder>` sets the folder of the
  download, for `ubq browser install` and for the tests. Use it
  for a cache that many CI jobs share.
- `UBQ_BROWSER=<path of a Chromium or Chrome program>` makes the
  tests use that program. No download is necessary then.

## Code for more than one runtime or system

Some code runs only on Bun, or only on Windows. One run cannot
run each line of such a project. The store keeps the coverage of
each environment (a runtime and a system, such as `bun-darwin`),
and `ubq uncovered` lists the code that no environment ran.

`ubq uncovered` tells you when you need this: it prints a note if
a range is on a line that names a runtime or a system
(`process.platform`, `Bun`, `Deno`).

On one machine, run the tests on each runtime. The second run
does not remove the coverage of the first:

```
npx ubq                        on Node
bun node_modules/.bin/ubq      on Bun
npx ubq uncovered              code that no runtime ran
```

For other systems, each CI job keeps its store, and one job
merges them. With GitHub Actions:

```yaml
jobs:
  test:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
      - run: npm ci
      - run: npx ubq
      - uses: actions/upload-artifact@v7
        with:
          name: store-${{ matrix.os }}
          path: .ubq/runs.db*
          include-hidden-files: true
  coverage:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
      - run: npm ci
      - uses: actions/download-artifact@v8
        with:
          pattern: store-*
          path: stores
      - run: npx ubq merge stores/*
      - run: npx ubq uncovered       # exit code 1 if no job ran some code
```

- `ubq merge <store>...` takes a project folder, a `.ubq` folder,
  or a `runs.db` file.
- Coverage of a file counts only if the file has the same content
  as now. Make each store from the same commit.
- `ubq uncovered` prints the environments, if there is more than
  one: `coverage of: bun-darwin, node-linux`.
- `ubq --changed` uses only the last run of each test.

## Tests that start a process

A test can start the program under test as a child process: a
command, or a server. The code of the project that the child runs
is coverage of the test, as the code that the test process runs.
So `ubq --changed`, `ubq uncovered`, and `ubq covers` work for
code that only a child runs. No setup is necessary.

```ts
import { spawnSync } from 'node:child_process'
import { assert, test } from 'ubqtest'

test('the command prints its version', () => {
  const r = spawnSync('node', ['src/cli.ts', '--version'], { encoding: 'utf8' })
  assert.match(r.stdout, /^\d+\.\d+\.\d+\n$/)
})
```

- It works for a child on Node, Bun, or Deno, and for the
  processes that the child starts. For Deno, the test process
  must be Node, and the test must start `deno run`, `deno test`,
  or `deno serve` itself, not through a shell.
- Stop a server with `child.kill()` in `cleanup`, and wait for its
  `close` event. The child writes its counts when it gets the
  signal. A child that ends with SIGKILL, and each child that is
  killed on Windows, can lose the counts of its last 200 ms.
- ubq adds a module to `NODE_OPTIONS` and `BUN_OPTIONS` in the
  environment of the test process, so that each child loads it. A
  child with a new environment gets it too, if the runner is Node.
- An error stack that the child prints has the correct lines. The
  columns can be too large, because the code has counters.

## Tests of a Cloudflare Worker

The test file runs in workerd, the runtime of Workers, with the
local bindings of the wrangler config (D1, R2, KV, Durable
Objects, vars). The project must have `wrangler`. Tell ubq which
test files are Workers tests, in `package.json`:

```json
{
  "ubq": {
    "workers": [
      { "config": "wrangler.jsonc", "include": ["test/**/*.test.ts"], "vars": { "API_KEY": "a test value" } }
    ]
  }
}
```

`vars` is optional. Its values go on top of the `vars` of the
wrangler config.

```ts
import { env } from 'cloudflare:workers'
import { assert, test } from 'ubqtest'
import { executionContext, migrate } from 'ubqtest/workers'
import worker from '../src/index.ts'

await migrate('DB')                      // the files of migrations_dir, for the D1 binding DB

test('lists the notes', async () => {
  const ctx = executionContext()
  const response = await worker.fetch(new Request('http://x/notes'), env, ctx)
  await ctx.settled()                    // the promises of ctx.waitUntil
  assert.deepEqual(await response.json(), [])
})
```

- `env` comes from the runtime (`cloudflare:workers`), not from
  ubq. It has the bindings of the wrangler config.
- A test does not get the values of `.dev.vars` or `.env`. Those
  files can have real secrets. Give test values in `vars` of the
  `workers` entry.
- A service binding to a Worker that is not this one gets a
  stand-in: `fetch` on it answers 503, and a call of a method
  throws. To test code that uses the service, give the handler
  an `env` object with your own value for that binding.
- Only the test file can do I/O at its top level (`await
  migrate('DB')`, a query, a `fetch`). A module that the test
  file imports cannot: workerd does not permit I/O while a module
  loads. Export a function from that module, and await it at the
  top level of each test file.
- Packages load as wrangler loads them: the `alias` key of the
  wrangler config works, and a CommonJS package gives its named
  exports.
- A wrangler config with `containers` works, but no container
  starts in a test run.
- `'ubqtest/workers'` has three functions:
  `executionContext()` makes the third argument of a handler,
  `scheduledController({ cron, scheduledTime })` makes the first
  argument of a `scheduled` handler, and `migrate(binding)`
  applies the D1 migrations.
- Each test file gets a new workerd process with empty storage.
  The tests of one file share that storage. A write of one test
  is there for the next test of the file.
- A project with more than one Worker has one entry in `workers`
  for each wrangler config.
- Coverage works as for other tests: `ubq --changed`, `ubq
  uncovered`, and `ubq covers`.
- `ubq` adds the `nodejs_compat` flag for the test run, because
  the test API uses modules of Node.
- A Workers test file is not a plain program: `node <test file>`
  cannot run it. Use `ubq <test file>`.

Not available in a Workers test file: `testdir`, `mockImport`,
`assert.snapshot`, and JSX files. A test that goes over its time limit fails, but the
report does not list what the test left open. There is no `SELF`
fetcher: call the handler of the Worker with a `Request`.

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
`helpers` (glob patterns for test helpers: see below), `build`
(glob patterns for build output and build tools: see below), `timeout`
(milliseconds), `hangRerun` (`false` turns off the rerun
of a test that timed out), and `bunInspectorCoverage` (`true`
records coverage for a plain `bun <test file>`, with places that
can be wrong. `ubq <test file>` on Bun does not need it), and
`browser` (see "Tests in a browser"), and `workers` (see "Tests
of a Cloudflare Worker"). A folder
with its own `package.json` is a different project: run `ubq` in
that folder. At the root of a monorepo with no tests of its own,
`ubq` runs each workspace.

Build output and build tools are not source of the program. `ubq
uncovered` does not list them. With no `build` key, they are the
files in `dist/` and `scripts/` of the project. The key replaces
that rule: `"build": ["out/**", "tools/**"]`. An empty list means
that each file is source. If a test loads a built file that has a
source map, the coverage is coverage of the source files that the
map names: the result is the same as for a test that loads the
source. After a change to a source file, build again before the
tests run: until then, the run has no coverage of that file.

A test helper is a file that is part of the tests and is not a
test file: a setup module, or the scenario of an end-to-end test.
`ubq uncovered` does not list its code, and `ubq mutate --diff`
does not change it. Do not write tests for a helper. With no
`helpers` key, a helper is each file in a folder with the name
`test`, `tests`, or `__tests__`. The key replaces that rule:
`"helpers": ["src/testing/**"]`. An empty list means that no file
is a helper. A change to a helper still makes `ubq --changed` run
the tests that loaded it.

## Requirements

Node 24 or later, or Bun, or Deno. TypeScript runs with no build
step, so the code must use only syntax that can be erased: no
`enum`, no `namespace`, no parameter properties. In
`tsconfig.json`, set `"allowImportingTsExtensions": true`,
`"noEmit": true`, and `"erasableSyntaxOnly": true`.

Bun and Deno also run `.tsx` and `.jsx` files, with coverage. Node
does not run them.

Tests of a Cloudflare Worker run in workerd, and the project must
have `wrangler`: see "Tests of a Cloudflare Worker".
