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
  Under `ubq`, `'../src/parse.js'` and `'../src/parse'` also find
  `parse.ts`, and `'../src'` finds `src/index.ts`. Source that
  imports files with no extension needs no change.
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

A first word that is the name of a ubq command, such as `diff` or
`sql`, is the command. If a file or folder has that name too, ubq
prints a note. `ubq run <paths>` treats each argument as a path,
so `ubq run diff` runs the tests in the folder `diff`. `./diff`
also works.

Put this script in `package.json`:

```json
"scripts": { "test": "ubq" }
```

`npm test` runs the tests. `ubq --update` runs them and writes
their snapshots. `ubq --update <file>` writes only the snapshots
of that file.

Each run also runs the type checker, if the project has
`tsconfig.json` and the `typescript` package. Each type error is a
`TYPE` block, and the run fails. The tests run in any case.
`"skipTypecheck": true` in the `ubq` key turns the check off: the
project then runs its type checker as a separate step.

- A folder with its own `tsconfig.json` is checked too, if a test
  file of the run is in it.
- If a folder has `tsconfig.ubq.json`, the check reads that file,
  and not the `tsconfig.json` of the folder.
- A `tsconfig.json` with only `references` (each project of an
  Nx monorepo has one) gives the checker no file. For such a
  folder, ubq writes `tsconfig.ubq.json` one time, and prints a
  note. The file extends the referenced config that has the test
  files (`tsconfig.spec.json`), with `composite` off. The checker
  then reads the source of the other projects, and they need no
  build. The file is yours: change it as the project needs, and
  commit it.
- A `tsconfig.json` with `references` and its own files reads
  each referenced project from its build output. If that output
  is not there, the checker reports TS6305: build the referenced
  projects (`tsc -b`) before the tests, in CI too. If the build
  puts test files in `dist`, ubq does not run them: with no
  `include` key, it does not look in the `dist` folder of the
  root.
- A run of all tests (`ubq`) reports each type error. A run of a
  selection (`ubq <file>`, `ubq --changed`) reports the type
  errors of the files that it used: its test files, and the
  files that their tests ran. It does not fail for the others.
  The summary has their count: `12 type errors in other files`.
  `ubq failures` prints them.
- If the type checker stops with no result, the run fails with a
  `TYPE` block that says so. Run again.

Use `npx ubq` if `ubq` is not on the path. On Bun: `bun
node_modules/ubqtest/cli.js`.

The last line of the output is the summary: `pass: 0 failed, 12
passed (run 7)` or `fail: 2 failed, 10 passed (run 8: ubq
failures 8)`. The command in a failed summary prints the failures
of that run again. Use it with the number: with no number, `ubq
failures` shows the newest run of the store, and a different
person or agent can have a newer run. Passed
tests print nothing. After a selection, `N not selected` counts the
tests that did not run in the files that ran. It does not count
the tests of files that did not run.

A run does not list code that no test ran. `ubq uncovered` lists
it, and `ubq check` names the changed lines that no test ran. To
fail a CI job for such code, run `ubq uncovered` as a second step:
its exit code is 1 if it lists code.

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
  since run 7, where it passed, these lines that it runs changed: src/parse.ts:12-14
  rerun: ubq test/parse.test.ts:6
```

The `since` line is in the block of a test that passed in an
earlier stored run. It names the lines that the test ran in that
run and that are different now: the change that most likely broke
it. A place can be `src/a.ts:12 (lines removed)` or `src/a.ts
(removed)`. A test that fails again keeps the line of its first
failure. If no line that the test runs changed, the line names
the changed lines that ran while its test file loaded, such as a
constant of a module. If none of those changed, the line says so:
then the cause is outside the code, such as a data file, a
snapshot, the environment, the time, or the order of the tests.
`ubq --repeat 10 '<test id>'` tells if the test is flaky.

A run prints 20 failure blocks at most, and 20 type error blocks
at most. Then one line gives the count of the others: `and 3 more
failures.` The command of the summary line prints all of them. In CI (`CI` is set),
each failure block prints.

At a terminal, `FAIL`, `ERROR`, `TYPE`, `SURVIVED`, and `fail` are
red, and `pass` is cyan. There is no color in a pipe or a file, in
CI, with `NO_COLOR` set, or with `FORCE_COLOR=0`.

In GitHub Actions (`GITHUB_ACTIONS` is `true`), each `FAIL`,
`ERROR`, and `TYPE` block also prints a line in the form of an
annotation of GitHub: the failure shows at its line in the view of
the changes of a pull request. `ubq uncovered` and `ubq uncovered
--diff` do the same for each range that no test ran, as a warning.
A step that runs `ubq uncovered --diff` puts the changed code with
no test next to the change. The path is from the root of the
repository (`GITHUB_WORKSPACE`), so a project in a folder of the
repository works too. GitHub shows 10 annotations of each kind for
each step.

A job in CI starts with no `.ubq` folder, so each run makes the
cache of the source with counters again. Keep the folder
`.ubq/counters` between jobs, and a run is as fast as on your
machine (for 20 test files on 2 CPUs: 0.8 s, not 1.0 s, and a
quarter less CPU time). The name of each entry comes from the
text of its file, so an old entry is never wrong. With GitHub
Actions:

```yaml
- uses: actions/cache@v4
  with:
    path: .ubq/counters
    key: ubq-counters-${{ github.sha }}
    restore-keys: ubq-counters-
```

If `GITHUB_STEP_SUMMARY` is set, as it is in GitHub Actions, a run
also adds a section to the summary of the step: the result line, a
table of the failures, errors, and type errors (20 rows at most),
with the place and the command that runs each again, and the notes
of the run. The summary is on the page of the run, above the logs.

## Rules that fail a test

- A test with zero assertions fails. There is no opt-out.
- `assert.rejects` or `assert.eventually` with no `await` fails.
- An assertion, a timer callback, or a promise of a test that runs
  after the test ended fails that test.
- A test that changes `process.env` or the working directory and
  does not put the change back fails. Use `env()` and `cleanup()`.
- A test that takes more than its time limit fails (default 5000
  ms), also a test that does not await: it fails when it ends. The message lists what the test left open. Then ubq runs
  that test one more time, and a `HANG` block names the line that
  opened each thing: `Timeout opened at test/a.test.ts:18:32`.
- Two tests with the same name in one group are an error.
- The name of a test or of a group must not have ` > ` in it: the
  ID of a test is `file > group > test`.
- A call to `process.exit` in a test file is an error.

Do not weaken a test to get a pass. Each of these rules catches a
test that would pass for the wrong reason.

## Before you say that the work is done

```
ubq check                 is the last result of the tests the result of the code as it is now?
ubq check --diff=<commit> the same, with the lines that differ from that commit (default: the last commit)
```

`ubq check` runs no test. It reads the store, and fails (exit code
1) if:

- a test failed in its last run, or a test file did not load
  (`ubq --failed`);
- code changed after the last run of the tests that ran it, or a
  test file never ran (`ubq --changed`);
- the last run had type errors;
- code in the lines that differ from the last git commit ran in no
  test, or a changed file with code is loaded by no test. ubq
  checks the lines only when the other checks pass, and only in a
  git repository.

Each problem is a line that names the command to run. The last
line is the result: `fail: 2 failed tests, 1 test file to run
again`, or `pass: 17 tests pass on the code as it is now, and each
change ran in a test.` A result of `ubq` that is older than your
last change is not a result of your change. Run `ubq check` before
you tell the user that the tests pass.

On a pass, `ubq check` also lists the changes to the tests that a
person must look at (the items of `ubq review`, in a git
repository). This output is the end of the work: put it at the end
of your last message, or in the description of a pull request.

```
ubq review                 the changes to the tests that a person must look at
ubq review --diff=main     the same, from where the branch left main
```

`ubq review` reads the git diff, the test files at the base commit
and now, and the store. It lists, with the most serious first:

- `configuration`: the `ubq` key of `package.json` changed. It can
  leave tests out.
- `removed`: a test that the base commit has, and the code does
  not. A test with a new name, and the same body or each of the
  old assertions, is not removed: review compares it as `<new ID>
  (was <old name>)`.
- `skipped`: a test with a new `skip`.
- `fewer assertions`: a test with fewer assertion calls than
  before, with the calls that went away (`-`) and the new ones
  (`+`).
- `assertions changed`: a test with the same count of assertions,
  and different ones.
- `snapshot removed`, `snapshot changed`: entries of
  `ubq-snapshots/`.
- `not measured`: a new `// ubq: not measured:` comment.

An item about assertions says if the test runs code that changed:
`The test runs code that changed: src/math.ts:12`. An expected
value that changed with the code it checks is correct only if the
old value was wrong. Say why in your report. The exit code is 1 if
the list has an item. The list is not a list of errors: a person
decides. Only tests with names of plain text are compared: a name
with `${}` is not known before its file runs.

In GitHub Actions, the list can be a comment on each pull request.
The job needs the base commit, and a run of the tests first: then
an item says if the test runs code that changed.

```yaml
  review:
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    permissions: { contents: read, pull-requests: write }
    steps:
      - uses: actions/checkout@v7
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v7
      - run: npm ci
      - run: npx ubq || true
      - env: { GH_TOKEN: '${{ github.token }}' }
        run: |
          npx ubq review --diff=origin/${{ github.base_ref }} > review.txt || [ $? = 1 ]
          { echo '```text'; cat review.txt; echo '```'; } > review.md
          gh pr comment ${{ github.event.pull_request.number }} --edit-last --create-if-none --body-file review.md
```

The pull request gets one comment, and each push changes it.
`--edit-last` changes the last comment of the user of the token:
if the workflow writes other comments, find the comment by a
marker instead. The workflow of ubq (`.github/workflows/ci.yml`)
does that, uses the coverage of all its CI jobs (`ubq merge`),
writes a comment only once the list has an item, and writes the
list to the job summary for a pull request from a fork, whose
token cannot write a comment.

`ubq skill` adds `ubq check --hook` to `.claude/settings.json` as
a stop hook of Claude Code, and says so. The hook does nothing in
a project that does not have `ubqtest`, such as one that removed
it: remove the entry in `hooks.Stop` of that file too. While `ubq check` finds a problem,
Claude Code cannot end its turn: it gets the report and works on.
When it stops again with the same report, the hook lets it stop,
so that it can tell the user what it could not do. A different
report blocks again.

## API

[Complete API reference](https://ubq.dev/api/)

```ts
test(name, fn)
test(name, { skip?: string | false, timeout?: number }, fn)
// fn gets { signal, skip }. skip('reason') ends the test as skipped, for a condition that the test knows only while it runs.
describe(name, fn)                 // a name prefix for its tests. fn is sync.
describe(name, { skip?, timeout? }, fn)

assert(value, message?)            // truthy. Narrows the type.
assert.equal(actual, expected)     // Object.is. Does not narrow the type.
assert.notEqual(actual, expected)
assert.deepEqual(actual, expected) // strict: same structure, values, prototypes
assert.match(actual, pattern)      // a partial object. A RegExp tests a string. A function tests a value: { id: (v: unknown) => typeof v === 'number' }
assert.matchOnly(actual, pattern)  // as match, and the value has no key that the pattern does not have, at each depth. For an exact comparison with a value that changes: { id: 1, time: (v: unknown) => typeof v === 'number' }
assert.contains(actual, expected)  // text in text, or an element of an array, Set, or other iterable
assert.notContains(actual, expected)
assert.greaterThan(value, target)  // value > target. A failure shows the two values.
assert.lessThan(value, target)     // value < target
assert.greaterThanOrEqual(value, target)   // value >= target
assert.lessThanOrEqual(value, target)      // value <= target
assert.close(value, target, precision?)   // the difference is less than 10 ** -precision / 2. The default precision is 2: less than 0.005.
assert.throws(fn, expected)        // expected is required. Returns the error.
await assert.rejects(promise, expected)   // resolves to the error
await assert.eventually(fn, pattern)      // as match. Calls fn again until it matches, 2000 ms at most.
assert.snapshot(value)             // compares with saved text
assert.fail(message)
// Each assertion takes a message as its last argument: assert.equal(a, b, `case ${name}`). A failure shows it first.
isDeepEqual(a, b)                  // true or false, by the rules of deepEqual. Not an assertion. A failed assert(value) shows the values of its calls.
isMatch(actual, pattern)           // true or false, by the rules of match. Not an assertion. assert(s.calls.some(call => isMatch(call.args, [{ id: 7 }])))
isMatchOnly(actual, pattern)       // true or false, by the rules of matchOnly

spy(impl?)                         // records calls in spy.calls: { args, result, error, this }. args is unknown[]. this is not enumerable: deepEqual of a call does not see it
spyOn(object, key, impl?)          // replaces a method until the test ends. A second spyOn on the key replaces the first.
await mockImport(() => import('../src/a.ts'), [
  [() => import('../src/dep.ts'), { fn: replacement }],
])                                 // a new instance of a.ts with a mocked dep.ts

testdir({ 'a.txt': 'hi', sub: { 'b.json': '{}' } })  // a new folder, returns its path
env({ NAME: 'value', OTHER: undefined })             // set or delete, until the test ends
stub(globalThis, 'navigator', value)                 // set a property, until the test ends. undefined fits each key
cleanup(() => server.close())                        // runs when the test ends
const clock = fakeClock({ now: 0 })                  // await clock.tick(ms), await clock.runAll(), clock.set(time)
```

- `expected` of `throws` and `rejects` is a `RegExp` for the
  message, an error class, or a partial object. An Error instance
  is not permitted: use `{ message: error.message }`.
- An object pattern of `match` permits extra keys in the value. An
  array pattern must have the same length.
- The expected value of `equal` and `deepEqual` must have the type
  of the actual value. If the type checker refuses a comparison,
  make the value exact (`value!`, or narrow it with
  `assert(value)`). To compare two different types on purpose:
  `assert.equal<unknown>(a, b)`. A type error in the expected
  value has a `hint:` line that says so.
- `assert(value)` narrows the type of `value`. `assert.equal` does
  not: a second `assert.equal` on a value that the code changed
  is not a type error. To narrow a union: `assert(shape.kind ===
  'circle')`.
- `spy()` with no implementation takes any arguments. A spy with an
  implementation has its types: if the test calls the spy itself,
  give the implementation the parameters of that call,
  `spy((event: Event) => event)`. The `args` of a call are
  `unknown[]`: compare them with `assert.deepEqual` or
  `assert.match`, and test the type of an argument before you
  read a property of it.
- A spy does not change after it is made. For a result that
  changes, the implementation reads a variable: `let result = 1;
  const s = spy(() => result)`. For a different result in each
  call: `spy.results(a, b)` gives `a`, then `b`. A result that is
  an Error instance is thrown, and a call after the last result
  throws. For an async function:
  `spy.results(Promise.resolve(a), Promise.reject(error))`. To
  forget the calls: `s.calls.length = 0`.
- The test function gets `{ signal }`. The signal aborts at the
  time limit. Pass it to `fetch` and to child processes.
- `skip` is the reason, as text: `{ skip: 'needs a GPU' }`. A
  condition: `{ skip: process.platform === 'win32' && 'needs fork' }`.
  For a condition that the test knows only while it runs, the
  test function gets `skip`: `test('x', async ({ skip }) => { if
  (!(await ready())) skip('the service is not there') ... })`.
- An assertion outside a test is a function that throws if its
  check fails: at the top level of a file, or in a `cleanup()` of
  the file. A failure there is an `ERROR` block of the file, with
  the values. `assert.snapshot` needs a test.
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
  `mockImport` at the top level gives one instance that all tests
  of the file share.
- A failed test keeps its `testdir` folder, and the failure block
  prints the path.
- The mock of `mockImport` must have the types of the real
  exports. It exists only in the returned module instance. Each
  call loads a new copy of the module, and of the project modules
  that it imports: their state is not the state of the copies
  that the test file imported. To share a module, such as a React
  context, give the copy of the test file as its mock:
  `[() => import('../src/context.ts'), await import('../src/context.ts')]`.
  The two loaders must have the form `() => import('...')`. A mock
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
- **A dependency of a dependency.** A mock replaces a module in
  the project modules of the new instance. It does not go into a
  package of `node_modules`. If a package imports the module that
  you want to replace, make an instance of the package with the
  mock, and give that instance as the mock of the package:

  ```ts
  const reader = await mockImport(() => import('reader'), [[() => import('node:fs'), fs]])
  const { find } = await mockImport(() => import('../src/find.ts'), [[() => import('reader'), reader]])
  ```

  On Node, `'fs'` and `'node:fs'` are one module: one mock is
  enough. `'node:fs/promises'` is a different module.
- A mock that no import of the new instance got is a failure of
  the test, when the test ends: "the mock of node:fs replaced no
  import". If the test has a different failure, that failure has
  the text as a `hint:` line.
- Snapshots are in `ubq-snapshots/`. Commit them. A value with no
  saved text fails. Only `ubq --update [file or test id]` writes
  them. Read the new text before you commit it. Each entry of an
  array or an object is on its own line in the text.

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
ubq slow [run]            the slowest tests of the last run of all tests, or of a run
ubq uncovered [file]      code that no test ran, in each file that a test loaded. Not test files, and not test helpers. Exit code 1 if it lists code.
ubq uncovered --diff      code that no test ran, in the lines that you changed (from the last git commit)
ubq merge <store>...      adds the coverage of other stores: a project folder, a .ubq folder, or a runs.db file
ubq covers <file>:<line>  the tests that ran a line
ubq sql '<query>'         a read-only SQL query, as JSON lines
```

[The tables of the store](https://ubq.dev/store/), with their
columns and example queries for `ubq sql`.

A run record has the variables of the environment that can change
a result: `NODE_OPTIONS`, `NODE_ENV`, `TZ`, `LANG`, `LC_ALL`,
`UBQ_COVERAGE`, and `UBQ_BROWSER`. If they differ from the run
before, `ubq failures` and `ubq show` print a line that names them:
`environment: TZ=UTC. In run 7: TZ not set`.

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
add a test for that case. The block names the tests that ran the
changed code, the closest first: a test of a test file with the
name of the source file (`test/cart.test.ts` for `src/cart.ts`),
then the tests that run the least other code. The first is usually
the best place for an assertion that the change breaks. Some
changes cannot make a test fail,
because the changed code does the same thing. Do not change
correct code for them. Run the tests before the check (`ubq`).

More run commands:

```
ubq --repeat <n> <selection>        run the tests n times, count the failures of each
ubq --baseline <commit> <selection> show only the failures that the git commit does not have
ubq --max-time <ms> <selection>     stop the run after that time
```

With `--max-time`, each file that runs at that time stops, with
the processes that its tests started. Files that did not start
do not start. Each of these files is an error of the run, and the
exit code is 1. The type check still runs to its end. Use it for
a run in the background that must not run for a long time.

`ubq status` shows the runs in progress in the project: for each
one, the files that ended and the counts of their results, each
file that runs now with its time, and the test that runs in that
file with its time. Use it when a run takes longer than you
expect, to find the test that hangs. A run of one file shows only
after the top-level code of its file. If the process of a run is
gone (it was stopped), `ubq status` says so. `ubq failures` and
`ubq sql` read the results that a run in progress has stored.

```
run 12: ubq test/ (pid 4242, 31.0 s)
37 of 40 files ended: 0 failed, 212 passed
test/cart.test.ts, 30.2 s: test/cart.test.ts > checkout sends the order, 29.8 s
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
- A test can start a browser itself, with the Playwright of the
  project: for a server of its own, or for headers that
  `browser()` does not give. Then call `await
  prepareContext(context)` of `ubqtest/browser` for each browser
  context that the test makes. A function that the test gives to
  `page.evaluate` has the coverage counters of ubq in its text,
  and with no call it throws `ReferenceError: __ubqc is not
  defined` in the page. Such a page gives no coverage of the code
  that it runs.

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
npx ubq                           on Node
bun node_modules/ubqtest/cli.js   on Bun
npx ubq uncovered                 code that no runtime ran
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
Objects, Workflows, vars). The project must have `wrangler`. Tell ubq which
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
- To send a request to the Worker as a client does, use `exports`
  of the runtime: `import { exports } from 'cloudflare:workers'`,
  then `await exports.default.fetch('http://example.com/path')`.
  It calls the default export of the `main` module of the
  wrangler config, with the bindings and an execution context of
  the runtime, in the isolate of the test: the modules and their
  state are the same. The test does not wait for the work that
  the handler gave to `ctx.waitUntil`. To wait for it, call the
  handler with `executionContext()`, as the example above does.
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
report does not list what the test left open. `SELF` of the
vitest plugin is `exports.default` of `cloudflare:workers`.

## Faster runs

`ubq server` starts a background server for the project. It keeps
test processes ready, so a run of a few files is about 30 ms
faster, and the first run after an edit about 45 ms. `--repeat`
is about 3 times faster. The commands,
the output, and the exit codes do not change. It stops after 30
minutes with no use, or with `ubq server stop`. It is optional.
The test processes that it keeps ready are Node processes. A
Workers test file starts its own workerd, so the server does not
make it faster.

## Editors

`ubq lsp` is a language server: an editor starts it, and talks to
it over stdin and stdout. It reads the store, and shows in each
open file of the project:

- the code that no test ran, as information;
- the failure of the last run of each test, and the error of the
  last run of each test file, as an error at its place;
- on hover, the tests that ran the code there;
- a code action, "Run the tests that ran this line (ubq)". It runs
  `ubq run` with those tests. The editor shows the start and the
  summary line, and the diagnostics change when the run ends;
- the places of the tests that ran the code at the cursor, for the
  commands below that go to them. Code that runs while a test file
  loads gives the first line of that file.

When a run ends, the open files show the new results. If a file
differs from the file of the last run of its tests (an edit in
the editor or on disk), the server shows only that fact, until a
run of those tests: `ubq --changed`.

For Neovim 0.12 or later, `ubq nvim` writes two files to the
configuration folder of Neovim: `lsp/ubq.lua` and
`plugin/ubq.lua`. Neovim then starts the server for a JavaScript
or TypeScript file in a project that has ubq in
`node_modules/.bin`, in its own folder or a folder above it. It
does not start the server in other projects. To keep these files
in your own configuration instead, copy them from
`node_modules/ubqtest/nvim/`.

`:UbqRunLine` runs the tests that ran the line of the cursor. It
is the code action, which `gra` also lists. To give it a key:

`:UbqTests` goes to the tests that ran the code of the cursor. If
there is one, it opens it. If there are more, it puts them in the
quickfix list, as `gd` does for a definition with many places.

```lua
vim.keymap.set('n', '<leader>tl', '<cmd>UbqRunLine<cr>', { desc = 'ubq: run the tests of this line' })
vim.keymap.set('n', '<leader>tt', '<cmd>UbqTests<cr>', { desc = 'ubq: go to the tests of this code' })
```

After an update of ubq, run `ubq nvim` again to get new commands.

The VS Code extension is in `vscode/` of the repository. It is not
on the Visual Studio Marketplace or Open VSX yet. It starts the
server for the first workspace folder that has ubq in
`node_modules/.bin`, in its own folder or a folder above it. The
command "ubq: Run the tests that ran this line" (`ubq.runLine`) is
the code action, with no menu. The command "ubq: Go to the tests of
this code" (`ubq.tests`) opens the test if there is one, and the
peek view if there are more, as Go to Definition does.

## Configuration

Most projects need none. The `ubq` key of `package.json` can have
`include` and `exclude` (lists of glob patterns for test files),
`helpers` (glob patterns for test helpers: see below), `build`
(glob patterns for build output and build tools: see below), `timeout`
(milliseconds), `hangRerun` (`false` turns off the rerun
of a test that timed out), and `bunInspectorCoverage` (`true`
records coverage for a plain `bun <test file>`, with places that
can be wrong. `ubq <test file>` on Bun does not need it), and
`browser` (see "Tests in a browser"), `workers` (see "Tests
of a Cloudflare Worker"), and `define` (global values that the
source reads, as the `define` of vite gives them: `"define": {
"__DEBUG__": true }`). `env` has values of the environment
for each test process (`"env": { "MODE": "dev" }`): a value of
the key is before a value of the shell. `skipTypecheck` (`true`)
turns off the type check of each run. `transform` is in "Source
that Node cannot run". A folder
with its own `package.json` is a different project: run `ubq` in
that folder. At the root of a monorepo with no tests of its own,
`ubq` runs each workspace: the folders of `workspaces` in
`package.json`, or of `packages` in `pnpm-workspace.yaml`.

Build output and build tools are not source of the program. `ubq
uncovered` does not list them. With no `build` key, they are the
files in `dist/` and `scripts/` of the project, and each config
file of a tool (`*.config.ts`, `*.config.js`). The key replaces
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

Code that no test can run can have a comment with the reason:
`// ubq: not measured: <reason>`. Examples: a fallback for a
value that is never absent, or code that runs before the coverage
hooks start. Put the comment on a line of its own above the code,
or at the end of the first line of the code. For a block, the
first line in the block also works. `ubq uncovered` does not list
that code, and it prints how many ranges it left out. A comment
with no reason does not count. For a file that no test can load,
such as the entry of a browser worker, put the comment before the
first code of the file: `ubq check` then does not fail for a
change to that file. Look for a test first: the comment
is for code that a test cannot reach.

## Requirements

Node 22.18 or later, or Bun, or Deno. `ubq doctor` tests the
functions of Node that ubq needs, not the version number. Two
limits of older versions:

- Node 23, and Node 24.0 to 24.2, print `ExperimentalWarning: Type
  Stripping is an experimental feature` to stderr for each process
  that loads a TypeScript file.
- In a CommonJS test file, `require('./file')` with no extension
  finds `./file.ts` on Node 24.18 or later of Node 24, and on
  Node 26.5 or later. It does not on Node 22, 25, or 26.0.
  An `import` finds it on each version.

TypeScript runs with no build
step, so the code must use only syntax that can be erased: no
`enum`, no `namespace`, no parameter properties. Node also does
not run decorators (`@Injectable()`). A project with such syntax,
such as a NestJS project, sets the `transform` key: see "Source
that Node cannot run". In
`tsconfig.json`, set `"allowImportingTsExtensions": true`,
`"noEmit": true`, and `"erasableSyntaxOnly": true`. If the project
builds JavaScript from that tsconfig (for example with tshy), set
`"rewriteRelativeImportExtensions": true` in place of `"noEmit"`.
It needs TypeScript 5.7 or later. Do not set
`"erasableSyntaxOnly"` if source files that no test loads keep
such syntax: the type checker then reports them in each run.
`ubq doctor` asks for the option only if no file has the syntax.

### Source that Node cannot run

If the source of a project has syntax that cannot be erased
(`enum`, `namespace`, a parameter property, a decorator), `ubq
doctor` names the files. The person who owns the project chooses
one of three. Do not choose for them: a compiler in the test run,
or a change of runtime, is a surprise to a maintainer.

1. **The TypeScript of the project.** `ubq convert
   --transform=typescript` sets `"transform": "typescript"` in the
   `ubq` key of `package.json`. The `typescript` package of the
   project then makes the JavaScript of each TypeScript file, one
   file at a time, as `ts-jest` with `isolatedModules` does. It
   needs TypeScript 5 or 6: TypeScript 7 has no function that
   compiles one file. The cost is about 4 ms for a file of 10 KB,
   one time for each change of the file: the result is in
   `.ubq/`. A process that must compile a file also loads the
   compiler, which is about 110 ms.
2. **swc.** `ubq convert --transform=swc` installs `@swc/core` as
   a devDependency with the package manager of the project, and
   sets `"transform": "swc"`. It is about 10 times faster (0.4 ms
   for the same file, and 20 ms to load), and it is a second
   compiler: its JavaScript is not in each case the JavaScript of
   `tsc`.
3. **Bun.** `bun node_modules/ubqtest/cli.js` runs such syntax
   with no key. Coverage on Bun has gaps that coverage on Node
   does not have. On Bun, a class with decorators does not load
   if a parameter of its constructor has a type that the file
   imports with no `import type`.

With each of the three, do not set `"erasableSyntaxOnly"`.

With the `transform` key, on Node:

- The compiler gets these options from the `tsconfig.ubq.json` or
  `tsconfig.json` of the folder of the file, or of the nearest
  folder above it: `experimentalDecorators`,
  `emitDecoratorMetadata`, `useDefineForClassFields` (and
  `target`, for its default), `verbatimModuleSyntax`,
  `esModuleInterop`, and `module`.
- The JavaScript is CommonJS if `module` is `commonjs`, or if it
  is `node16` or `nodenext` and the package does not have
  `"type": "module"`. If not, it is an ES module. A CommonJS test
  file has `require` and `__dirname`, and no `import.meta`.
- The compiler removes an import that the file uses only as a
  type. It reads one file at a time, so it does not know if a
  name of a different file is a type. With
  `emitDecoratorMetadata`, a type of a constructor parameter is
  a value in the JavaScript. In CommonJS that is not a problem.
  In an ES module, the import of an interface for such a
  parameter must be `import type`, or the file does not load.
- The compiler does not check types. The type check of the run
  does that, as before.
- A stack trace, a failure block, and coverage have the lines of
  the source.
- `mockImport` works for CommonJS and for ES modules. In a
  CommonJS instance, a dependency that is an ES module is not a
  new instance.
- Bun and Deno compile TypeScript themselves, and do not read
  the key.
- `.tsx` files are not compiled. Node does not run them.

Bun and Deno also run `.tsx` and `.jsx` files, with coverage. Node
does not run them.

Tests of a Cloudflare Worker run in workerd, and the project must
have `wrangler`: see "Tests of a Cloudflare Worker".
