# Status

What exists, by step of the build order in `04-architecture.md`,
section 13. Update this file when a step ends.

## Commands

| Command | Does |
| --- | --- |
| `npm test` | runs the tool's own tests with ubq itself: `node src/cli.ts` |
| `npm run typecheck` | must print nothing |
| `npm run build` | makes the package in `dist/` (D32): bundled JavaScript, type declarations, `package.json` |
| `npm run bench` | builds, then times ubq and other tools. `-- --check` fails if a ubq row is over its budget. `-- --only ubq` runs only ubq rows. |

## Checks before each commit

```
npx tsc                 # must print nothing
node src/cli.ts         # the tool runs its own tests: 88 pass
npm run bench -- --only ubq --check   # speed guards (builds first)
```

The suite needs `bun` and `deno` on the path for all tests. A test
skips itself, with a reason, if its runtime is not installed (8
tests need `deno`).

The tool needs Node 24. If `node -v` shows an older version, look
for a newer one on the machine (a cloud session has
`/opt/node24/bin`), and put it first on the path.

The budgets of the benchmark are for the machine of the first
measurements. On a different machine, all rows can be over budget.
Then run the benchmark on the commit before the change and on the
change, and compare the two.

If a test fails, `node src/cli.ts failures` prints the failures of
the last run again, and `node src/cli.ts failures <run>` prints an
older run.

## Lessons for work on this repository

- A command that can hang must run under `timeout`. A wedged test
  process once ran until the tool call timed out.
- A test process that starts child processes must not pass
  `UBQ_*` variables on. The library removes them when it loads.
- Two test files must not share one fixture store. Test files run
  in parallel. `test/bun.test.ts` works on a copy of the coverage
  fixture for this reason. `test/plain.test.ts` removed the store
  of `test/fixtures/` while `test/runner.test.ts` wrote to it; the
  random order of files (D28) made this fail. It has its own
  project now (`project()` in `test/setup.ts`).
- A change to a sink must not throw on a closed pipe. An error
  handler that writes to the same pipe makes a loop.
- The benchmark guards catch real regressions. A watchdog thread
  in each child added 300 ms to the 200-file run before the guard
  showed it.
- An import in a file that each test process loads has a cost in
  each process. `node:child_process` added 9 ms to a run of one
  file. Load such a module at the place that needs it
  (`process.getBuiltinModule`).
- Deno compiles TypeScript itself. A load hook there gets
  JavaScript, V8 coverage has the positions of that JavaScript,
  and stack traces go through the map of that JavaScript. Test a
  Deno feature with the built package (`test/package.test.ts`).
- A bundle must not contain the text of a source map marker at
  the start of a line. Deno read one in a string as the map of
  the bundle.
- The machine gets slower during long sessions (Node start went
  from 28.7 ms to 31.3 ms). Compare against `node -e 0` on the
  same day.

## Step 0: done (2026-11-11)

- `package.json`, `tsconfig.json`, `.gitignore`.
- `docs/05-api.md`, `docs/06-events.md`, `src/events.ts`.
- `experiments/suite/bench.mjs`.
- `esbuild` is a development dependency for the bundle. The
  package still has no dependencies at install time.

## Step 1: done (2026-11-11)

Source files:

| File | Contents |
| --- | --- |
| `src/index.ts` | public exports, starts the plain program role |
| `src/test.ts` | `test`, `describe`, the loop that runs tests one at a time |
| `src/assert.ts` | the assertion functions |
| `src/format.ts` | values as text, differences with paths |
| `src/stack.ts` | stack traces as user code locations |
| `src/state.ts` | the `AsyncLocalStorage` for the current test |
| `src/emit.ts` | publishes events on `diagnostics_channel` |
| `src/plain.ts` | runner role for a plain program |
| `src/sink-text.ts` | compact text sink |
| `src/hint.ts` | errors for wrong guesses |
| `src/project.ts` | project root, relative paths |

Checks (`test/plain.ts`, `test/types.ts`):

- The fixtures in `test/fixtures/` give the same exit code and
  summary on Node, Deno, and Bun. Node and Deno give the same
  text, byte for byte (`*.out` files).
- Zero assertions fails. So do: `assert.rejects` with no `await`,
  an assertion that a `catch` took, an assertion after the end, an
  error in a callback, a timeout, a duplicate name, and a file
  with no tests (exit code 2).
- Each wrong guess in `test/fixtures/types-bad.ts` is a compile
  error that names the fix.
- Speed, with the bundle and with no coverage yet: 57 ms for one
  TypeScript file as a plain program (budget 65), 35 ms with the
  compile cache (budget 40).


Known limits:

- The stack parser reads POSIX paths only. Windows needs work.
- Bun reports different columns for some frames, and gives no
  location for an assertion in a timer callback.
- A sync test cannot time out in its own process. The runner
  handles that case in step 4.
- A timer that a timed-out test leaves behind keeps the process
  alive until it fires.
- Text output has no size limit yet.

## Step 2: done (2026-11-11)

Source files:

| File | Contents |
| --- | --- |
| `src/coverage.ts` | V8 collector: start, snapshot, `flatten` |
| `src/preload.ts` | `node --import ubqtest/preload`: starts coverage before user modules load |
| `src/store.ts` | `.ubq/runs.db`: schema, writer sink, retention |
| `src/query.ts` | `uncovered`, `covers`, failures, last result |
| `src/cli.ts` | the `ubq` command: `failures`, `show`, `uncovered`, `covers`, `sql` |

Run the CLI from source with `node src/cli.ts <command>`.

Checks (`test/coverage.ts`, fixture project `test/fixtures/cov/`):

- `uncovered` lists a branch not taken, an inner function that
  was not called, and a function that never ran.
- `covers` names the tests that ran a line, and the test file for
  code that ran at load.
- A new run of a test replaces its coverage rows.
- Command errors exit with code 4.
- Speed with coverage and the store on: 66 ms plain (budget 70),
  43 ms with the compile cache (budget 45). The budgets moved up
  by 5 ms; `04-architecture.md`, section 12, has the reason.

What was learned:

- V8 lists a function that never ran only if coverage started
  before the function's module ran its top-level code. The library
  now starts coverage in the same tick as its own load (no
  `await`), so a test file that imports `ubqtest` before its source
  modules gets full data.
- A plain run cannot know the import order, so it records its
  coverage as `partial`. `ubq uncovered` prints a note for such
  files. A run with `--import ubqtest/preload` records `full`.
- On Deno the collector works (later: its positions are wrong for
  TypeScript, see D33). On Bun there is no collector yet
  (`none`), as planned for step 5.
- The fixtures are their own project (`test/fixtures/package.json`)
  so that test runs do not write to the store of this repository.
  `test/setup.ts` links `ubqtest` into the fixture `node_modules`.

Known limits:

- `ubq uncovered` reads the source file as it is now. If the file
  changed after the run, lines can be wrong. The store does not
  hold content hashes yet (step 6 needs them for `--changed`).
- The Deno inspector answers later than Node's, so coverage start
  on Deno can be late. Not measured yet (step 8).

## Step 3: done, with one target not met (2026-11-11)

Source files:

| File | Contents |
| --- | --- |
| `src/runner.ts` | finds test files, orders them, starts a process for each, reads events, totals |
| `src/sink-pipe.ts` | a child writes its events as JSON lines to fd 3 |
| `src/cli.ts` | now also runs tests: `ubq`, `ubq <file or folder>...`, `ubq <file>:<line>` |

How a run works:

- A test file has a name that ends in `.test.ts` (or `.test.js`,
  `.test.mts`, and so on). `ubq` with no arguments runs all of
  them in the project. An argument can be any file, or a folder.
- One selected file runs in the CLI process, with the compile
  cache and early coverage. More files run in child processes,
  one for each file, as many at a time as the machine has cores.
- Files that failed in the last run start first, then the slowest.
- `<file>:<line>` selects the test that starts at or before the
  line and is nearest to it. The summary counts the tests that
  were not selected.
- Exit codes: 0 pass, 1 failure or file error, 2 no tests, 4
  command error. Code 3 (coverage level) has no feature yet.
- With `CI` set, the first line of output states the runtime, the
  platform, and the command.

Checks (`test/runner.test.ts`): 38 tests in 4 files, run by ubq.

What was learned:

- Code that calls `process.exit` in a test ended the process with
  no summary, and code 0 looked like a pass. The library now
  reports this as a file error.
- A test that starts a child process gave the child the runner's
  environment variables, and the child then wrote events to a
  pipe that it did not have. The library now removes its
  variables from `process.env` when it loads.
- A write to a closed pipe threw inside the error handler and
  looped. The text sink and the pipe sink now stop on the first
  write error.
- Two runs in one project gave "database is locked". The store
  sink now collects events and writes them in short transactions
  that take the write lock at the start.
- A query for run history with no index made each run slower
  than the last. The store has an index for it now.
- Coverage is one row for each test and source file, with the
  ranges as JSON. One row for each range made the store 4 times
  slower.

Speed: see `04-architecture.md`, section 12. One file meets its
target. 200 files take 885 ms against a target of 650 ms.

Not done in step 3:

- Output of a child on stdout and stderr is dropped, except for
  the last lines of stderr when the process dies. Step 4 captures
  it for each test.
- The CI text has only the header line. Console output and hang
  reports come with step 4.
- (Done later, in steps 5 and 8.) Deno and Bun as the runtime of
  the runner are not tested. The
  runner starts children with its own runtime.

## Step 4: done, without hang reruns (2026-11-11)

Source files:

| File | Contents |
| --- | --- |
| `src/capture.ts` | console capture: stdout and stderr text becomes `output` events |
| `src/probe.ts` | reads the stack of a stuck process through the inspector |
| `src/watchdog.ts` | worker thread that stops a stuck process that has no runner |

What it does:

- Under `ubq`, a failure block shows the console output of its
  test (last 20 lines, all lines in CI). `ubq show` prints it. A
  plain program keeps its console.
- A promise that can never settle fails the test at once.
- A timeout names what the test opened and left open
  (`still open: TCPServerWrap`).
- Tests that end while the process stays alive: a file error,
  1000 ms after the last test, and the process exits.
- A loop that does not return: stopped 500 ms after the limit of
  the test, with the line of the loop in the failure.
- When a child ends, the runner kills its process group. The
  runner passes SIGINT, SIGTERM, and SIGHUP on to all groups.

Checks: `test/runner.test.ts`, fixtures `hang.ts`, `busy.ts`,
`output.ts`, `orphan.ts`. 43 tests.

Not done:

- (Done later: "Hang reruns" below.) **Hang reruns (D14).** The
  rerun of a timed-out test with async tracking, to get the line
  that opened each resource.
- The watchdog thread uses inspector port 9229. If a different
  process has that port, the failure has no stack, only the
  message.
- Leak checks after each test (changed globals, environment
  variables, working directory) from `01`, section 9.

Known limits:

- When the watchdog thread stops a process with no runner, the
  run is not written to the store, and the exit code is 137.
- Node prints "Debugger listening" on stderr when the watchdog
  starts the inspector.

## Step 5: done for coverage, not for mocks and hang reports (2026-11-11)

Source files:

| File | Contents |
| --- | --- |
| `src/instrument.ts` | adds a counter to each function and branch of a source file, and maps each counter to a source range |
| `src/counters.ts` | counter regions and snapshots, with no parser, so that a process can read counters and not load the parser |
| `src/bun-preload.ts` | `bun --preload ubqtest/bun-preload`: a load plugin that adds the counters, and the collector that reads them |

What it does:

- `bun src/cli.ts <files>` runs tests on Bun with full per-test
  coverage, for one file and for many files. The runner starts
  each child with `--preload`.
- The `coverage` events have the same form as on Node, so the
  store and the queries are the same code.
- A plain `bun test/foo.ts` has no preload, and records coverage
  `none`.

Checks (`test/bun.test.ts`):

- The changed source gives the same result as the original for a
  sample with each construct that gets a counter, and each line
  keeps its number.
- On the coverage fixture, `uncovered` and `covers` give the same
  answers on Bun as V8 gives on Node. Two ranges start 1 or 2
  columns later.

Decisions in this step are D21 and D22 in `02-decisions.md`.

Not done:

- (Done later, in step 7.) Module mocks on Bun.
- A hang report on Bun has no stack. `SIGUSR1` does not start an
  inspector there.
- `.tsx` and `.jsx` files get no counters.
- The changed source is not cached. The parser reads about 3 MB
  of source for each second, so a large project pays for it in
  each process.
- `dist/bun-preload.js` is 418 KB, because it contains the parser.
  It is not minified yet.

Known limits:

- A file that the parser cannot read runs with no counters, and
  the test file records coverage `partial`. The parser does not
  read a `const` type parameter in an interface method
  (`src/assert.ts` has one).
- Counters for code after `return` or `throw` exist only at
  statement level in a block. An expression that throws in the
  middle of a statement counts the rest of the statement as run.

## Step 6: done (2026-11-12)

Done:

- `ubq '<test id>'` runs one test. The ID of a group runs its
  tests.
- `ubq --failed` runs each test that failed in the last run of its
  file, and each file that had a file error.
- `ubq --changed` runs each test file that loaded a file whose
  content differs now, each new test file, and each test file
  whose loaded files are not known. It prints the changed files.
  Selection is at file level.
- Each coverage row has the content hash of its source file (store
  schema 3). `coverage` events name their test file.
- Configuration and the project boundary: `08-config.md`.

- `ubq history '<test id>'` prints the result of one test in each
  stored run. It says that the test is flaky if the test passed
  in one run and failed in a different run with the same code.
- `ubq diff [run] [run]` prints the tests whose status differs in
  two runs. With no run numbers, it compares the last run with the
  run before it. With one, it compares that run with the last run.
  The exit code is 1 if the second run has a failure or a file
  error that the first run does not have.
- Each test row has a digest of the code that the test loaded
  (store schema 4, column `test.code`): the content of each file
  that ran code while the test file loaded or while the test ran.
  It is null if the run has no coverage for the test.

- `ubq --repeat <n> <selection>` runs the selected tests n times
  and counts the failures of each test (`src/repeat.ts`). The
  exit code is 1 if a test failed one time or more. The store has
  one run for all the repeats (store schema 5, columns
  `test.repeats` and `test.fails`). `history` and `show` print
  the counts, and `--failed` selects a test that failed some
  times.

- `ubq --baseline <commit> <selection>` runs the tests of the
  commit in a clean checkout, then the tests of the working tree
  (`src/baseline.ts`, D26). The text shows the failures that the
  commit does not have, and lists the IDs of the others and of
  the fixed tests. The exit code and the store have all failures.
- `ubq slow [run]` prints the 10 slowest tests of a run.
- Two processes that start in a project with no store do not
  fail with "table run already exists".

Checks: `test/select.test.ts` (IDs, `--failed`, `--changed`,
configuration), `test/history.test.ts` (`history`, `diff`,
`--repeat`, `--baseline`). `test/setup.ts` has the helper that
makes a project in a temporary folder.

Not done in step 6:

- (Done later: D27.) Run records have the git commit
  (`src/git.ts`, store schema 6). `history` prints it.
- `--changed` at the level of ranges, and "run all tests" for a
  changed file that is not code.

Known limits:

- `--changed` does not see a change in a file that no test loaded
  as code: a JSON fixture, a config file, a lock file.
- With nothing to run, `--failed` and `--changed` exit with code 2.
- The flaky note of `history` does not see a change in a file that
  is not code, as for `--changed`. It compares runs on the same
  runtime only. A test that failed before it could import a file
  with `import()` has a different digest from a run that passed,
  so the note can be absent for a flaky test. It cannot be present
  for a test whose code changed.
- The repeats of `--repeat` run one after the other, so 100
  repeats of a file of 50 ms take 5 seconds or more. Two processes
  of one test file at the same time can fail for that reason only,
  and the count must not include such failures.
- The checkout of `--baseline` has the files of the commit only.
  A test that needs a file that git does not have (a build
  result, a `.env` file, a submodule) fails there, and then its
  failure in the working tree is not "new".
- `--baseline` runs the suite two times. It does not go with
  `--repeat`, `--failed`, or `--changed`.
- In this repository, the test files of the checkout import the
  library of the checkout (the package imports itself by name),
  and the runner is the one of the working tree. In other
  projects, both come from the `node_modules` of the project.
- A new schema version removes the old store. If two `ubq`
  processes start at the same time after such a change, one of
  them can fail one time. This occurred one time in the fixture
  store that the test files share.
- `diff` compares the tests that ran in the two runs. It counts the
  tests that ran in only one of them, and lists such a test only if
  it failed in the second run.

## Step 7: done (2026-11-12)

Source files:

| File | Contents |
| --- | --- |
| `src/fixtures.ts` | `cleanup`, `env`, `testdir`, and the cleanup functions of the file |
| `src/spy.ts` | `spy`, `spyOn` |
| `src/clock.ts` | `fakeClock` |
| `src/real.ts` | the real timers and clocks, for the library itself |
| `src/snapshot.ts` | `assert.snapshot`: the snapshot file, compare, write |
| `src/mock.ts` | `mockImport`: resolve and load hooks, registered at the first call |

Done (`05-api.md`, sections 6 and 7):

- `cleanup`, `env`, `testdir`, `spy`, `spyOn`, in a test and at the
  top level of a file. They work on Node and Bun.
- A failed test keeps its `testdir` folder. The failure block, `ubq
  show`, and `ubq failures` print the path while the folder exists.
- An error from a callback of a test that ended before is a
  `late-failure` of that test. Before, it was a failure of the test
  that ran at that time. On Bun, this is so for a thrown error only,
  not for a rejected promise.

- `mockImport` on Node. A mock has the types of the real module,
  and `test/fixtures/types-bad.ts` has wrong mocks that must not
  compile. Coverage of a mocked instance goes to the real file.
  It works with the V8 collector and with source counters.

- The test files run in a random order (D28, `src/shuffle.ts`).
  A run with a failure prints the seed, and `ubq --seed <n>`
  repeats the order.
- A test that changes `process.env` or the working directory and
  does not put the change back fails, and ubq puts the old values
  back (D29).

- `fakeClock` (D30). The library takes its own timers from
  `src/real.ts`, so the time limit of a test stays real.

- `assert.snapshot` and `ubq --update` (D31).
- The check for a process that does not exit waits one more time
  if nothing is open. On a slow machine, it reported a process
  that was about to exit.

- `mockImport` on Bun, through `Bun.plugin` (`05-api.md`, section
  6, has the differences). Coverage of a mocked instance goes to
  the real file there too. On Deno, `mockImport` works with the
  Node code. `test/fixtures/mock.ts` runs as a plain program on
  the three runtimes, and under the runner on Node and Bun.

Checks: `test/snapshot.test.ts`, `test/clock.test.ts`, `test/fixtures.test.ts`, fixtures `test/fixtures/fix.ts`,
`test/fixtures/mock.ts`, and `test/fixtures/leak.ts`. For Bun and
Deno: `test/bun.test.ts`, `test/plain.test.ts`.

All parts of step 7 are built. Its check passes: a wrong mock does
not compile, and mocks work on Node and Bun.

Known limits:

- On Bun, a string in a mocked instance that has the form of an
  import (`"from './db.ts'"`) gets the mock number too, if its path
  is a project file or a mocked module.

- The cleanup functions of the file run when the queue of tests is
  empty. A file that calls `test` after an `await` that comes
  after the first `test` call gets an error, if the file has
  top-level fixtures.
- On Bun, `import { setTimeout } from 'node:timers'` keeps the real
  timer under a fake clock. Bun does not update the names of a
  builtin module. The globals are replaced.
- Timers that wait when a fake clock ends are dropped, with no
  message.
- `mockImport` does not replace a dependency that the code loads
  with `require`, and a mock of a package does not reach the code
  of other packages.
- The module hooks stay for the life of the process after the
  first `mockImport` call. Each later import in the process goes
  through them.
- Two tests whose names differ only in characters that are not
  safe in a path have the same `testdir` folder.

## Step 8: done (2026-11-12)

Done:

- The package build (D32, `scripts/build.ts`). The JavaScript is
  minified: 320 KB, of which the parser for source counters is
  232 KB. `test/package.test.ts` builds the package into a new
  project. There, a test file runs as a plain program on Node,
  Deno, and Bun, `ubq` runs with coverage on Node and Bun, and the
  type checker gives the hint for a wrong guess.

- Deno parity (D33). `deno run -A node_modules/ubqtest/cli.js`
  gives the same text as Node for the fixtures `fail.ts`,
  `mock.ts`, `output.ts`, `hang.ts`, and `busy.ts`, and the same
  answers from `covers` and `uncovered`
  (`test/package.test.ts`). What it needed:
  - A child on Deno writes its events to `/dev/fd/3`.
  - Coverage on Deno is source counters. The load hook reads the
    file, adds the counters, removes the types
    (`stripTypeScriptTypes`), and adds an empty source map.
    With no map in the text, Deno changes stack positions with
    the map of its own JavaScript.
  - The console of Deno does not write through `process.stdout`,
    so the capture replaces `console` there.
  - A Deno child starts with `--inspect=127.0.0.1:0`. Deno has no
    signal that starts the inspector, and SIGUSR1 ends a Deno
    process. The flag adds no time that the benchmark can see
    (10 starts: 90 ms with it, 86 ms with no flag).
- Type checks next to tests (`src/typecheck.ts`, question Q7 in
  `09-questions.md`). A run of all tests, or a run with
  `--types`, starts `tsc --noEmit` of the project at the same
  time as the test processes. Each error is a `type-error` event
  and a `TYPE` block in the text (20 blocks at most). The summary
  counts them, and the exit code is 1. The tests run in any case.
  Checks: `test/typecheck.test.ts`.
- The check of step 8 passed (2026-11-12). An agent on the
  smallest model, with `ubq guide` as its only document, wrote 10
  tests for a small module (with `mockImport`, `spy`, and
  `assert.rejects`), found the planted error, and corrected it.
  It made no wrong call to the tool. Its notes about the guide
  are in the guide now: where test files can be, an example of a
  mock with a spy, the exit code of `doctor`.
- The agent guide: `GUIDE.md` at the package root. `ubq guide`
  prints it. It has the API, the rules that fail a test, the
  names that do not exist with their replacements, and the
  commands.
- `ubq doctor` (`src/doctor.ts`). It checks the runtime version,
  the project root, that the project can import `ubqtest`, the
  configuration, the count of test files, files that have tests
  and a name that `ubq` does not run, and two options of
  `tsconfig.json`. Each problem is one `FIX` line with the fix.
  The exit code is 1 if there is a problem. Checks:
  `test/doctor.test.ts`.

Known limits:

- `doctor` does not read a `tsconfig.json` that has `extends`.
- Type errors are not in the store. `ubq failures` does not print
  them again.
- The type check reads only `tsconfig.json` in the project root.
- A project with one test file runs that file in a child process
  if the type check is on, not in the process of the runner.
- A plain `deno run -A test/foo.ts` records coverage `none`, as a
  plain program on Bun does.
- On Deno, the changed source of a file is in the cache, but the
  removal of the types runs again in each process.
- The Deno tests use the built package. From the source
  (`deno run -A src/cli.ts`) in a different project, Deno does
  not find the parser, which is a development dependency here.
- A test process on Deno that has no runner and is in a loop
  that does not return gets no stack (the watchdog thread has no
  inspector there).

## Hang reruns: D14 done (2026-11-12)

The part of step 4 that was not built. Source: `src/hang.ts`.

- A test that timed out with something open runs one more time,
  alone, in a new process with an `async_hooks` init hook. The
  hook keeps the stack of each resource that the test opens. At
  the time limit, the process writes the user code location of
  each resource that is still open to a file in `.ubq/`, and
  exits.
- The result is a `hang` event. The text has a `HANG` block with
  the type, the location, and the source line. The store adds
  the locations to the failure of the test, so `ubq failures`
  prints them.
- The runner does the reruns after all files ended. A plain
  program, and a file that runs in the process of the runner, do
  them when the file ends. 3 reruns at most for each run.
- `"ubq": { "hangRerun": false }` turns the reruns off.
- Checks: `test/runner.test.ts`, and for Deno
  `test/package.test.ts`.

Known limits:

- The reruns go one after the other, and each one waits for the
  time limit of its test: 15 seconds more for 3 tests with the
  default limit.
- Bun has no reruns: its `async_hooks` gives no events.
- On Deno, the rerun names the place that started a timer, but
  not the place that opened a server: Deno gives no event for
  it.
- The rerun runs the top-level code of the test file again.
- With `--repeat`, there are no reruns.

## Source counters on Node: D25 done (2026-11-12)

Step 3: the runner uses counters on Node, for its children and
for a run of one file in its own process. `UBQ_COVERAGE=v8` goes
back to V8.

- The changed source has more text on a line, so a stack trace has
  different columns. The cache of changed source now has the added
  text of each line (`shifts`), and `src/stack.ts` gives the column
  of the source. The runner and the watchdog thread do the same
  for the stack of a stuck process, from the cache. This also
  corrects columns on Bun.
- Two instances of one module (`mockImport`) count in one array.
  Before, the second instance took the array of the first.
- Speed on the cloud machine (not the machine of the budgets):
  200 files 3570 ms with counters, 4456 ms with V8. One file
  83 ms, 93 ms with V8.
- One answer differs from V8, and counters are correct: a module
  that was loaded and did not run (its import failed) has no
  coverage. With `UBQ_COVERAGE=v8`, one check in
  `test/fixtures.test.ts` fails for this reason.

The text below is the state after steps 1 and 2.

Source files:

| File | Contents |
| --- | --- |
| `src/counter-collector.ts` | the collector for counters, and the cache of changed source in `.ubq/counters/` |
| `src/counters-preload.ts` | `node --import ubqtest/counters-preload`: a load hook that adds the counters |
| `src/bun-preload.ts` | now uses the same collector and cache |

- The cache key is a hash of the file path and its content. A
  process that finds all its files in the cache does not load the
  parser.
- `test/counters.test.ts` compares counters with V8 on
  `test/fixtures/diff/`. Lines with uncovered code are equal. The
  tests for each line are equal, but for two accepted differences:
  a class field with no value, and the name of a method that no
  test calls.
- To make the answers equal, the regions of the counters changed:
  `else`, `?`, `:`, `&&`, a `case` label, and a method name now
  belong to the branch or the method, as in V8. A class field with
  a value has a counter.
- After that change, the checks of `03-measurements.md`, section
  12, gave the same results again.

Known limits:

- The parser does not read `src/assert.ts` (a `const` type
  parameter in an interface method). A project file like it runs
  with no counters, and its test files record coverage `partial`.
- In this repository, the files in `src/` are the library, and the
  collectors leave the library out. So `ubq uncovered src/...` has
  no data here.
