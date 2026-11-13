# Status

What exists, as a short log by step of the build order in
`04-architecture.md`, section 13. Add a short entry when a step
ends. The details of older steps are in the git history.

## Commands

| Command | Does |
| --- | --- |
| `npm test` | runs the tool's own tests with ubq itself: `node src/cli.ts` |
| `npm run typecheck` | must print nothing |
| `npm run build` | makes the package in `dist/` (D32): bundled JavaScript, type declarations, `package.json` |
| `npm run docs` | builds, then makes `docs/api.md` from the type declarations (`scripts/api-docs.ts`). A test fails if the file is not current. |
| `npm run bench` | builds, then times ubq and other tools. `-- --check` fails if a ubq row is over its budget. `-- --only ubq` runs only ubq rows. |

## Checks before each commit

```
npx tsc                 # must print nothing
node src/cli.ts         # the tool runs its own tests: all pass
npm run bench -- --only ubq --check   # speed guards (builds first)
```

The suite needs `bun` and `deno` on the path for all tests. A test
skips itself, with a reason, if its runtime is not installed.

The tool needs Node 24. If `node -v` shows an older version, look
for a newer one on the machine (a cloud session has
`/opt/node24/bin`), and put it first on the path.

The budgets of the benchmark are for the machine of the first
measurements. On a different machine, or late in a long session,
rows can be over budget. Then run the benchmark on the commit
before the change and on the change, and compare the two.

If a test fails, `node src/cli.ts failures` prints the failures of
the last run again, and `node src/cli.ts failures <run>` prints an
older run.

## Lessons for work on this repository

- A command that can hang must run under `timeout`.
- A test process that starts child processes must not pass
  `UBQ_*` variables on. The library removes them when it loads.
- Two test files must not share one fixture store, and a test must
  not ask a shared store for the last run. Test files run in
  parallel and in a random order (D28). Use `project()` in
  `test/setup.ts`.
- A sink must not throw on a closed pipe. An error handler that
  writes to the same pipe makes a loop.
- The benchmark guards catch real regressions. Run them.
- An import in a file that each test process loads has a cost in
  each process. Load such a module where it is needed
  (`process.getBuiltinModule`).
- Deno compiles TypeScript itself. A load hook there gets
  JavaScript. Test a Deno feature with the built package
  (`test/package.test.ts`).
- A bundle must not contain the text of a source map marker at
  the start of a line. Deno reads one in a string as the map of
  the bundle.
- A named import from a `node:` module that one runtime does not
  have stops each process on that runtime at load. Import the
  module as a whole, and test for the function.
- A push to `main` cancels the CI run of the push before it. To
  see a result, wait for the run to end before the next push.
- CI starts with no `.ubq/` folder. `rm -rf .ubq` before a local
  run finds defects that need an empty cache or a new store.
- CI can have a newer Bun and Deno than the developer machine. A
  test must not depend on data that changes with the version of a
  runtime.
- The tests remove `CI` from their environment (`test/setup.ts`).
  A test that needs it gives it to the run that it starts.
- Windows: a path has `\`, a temporary folder can have a short
  name (`RUNNER~1`), a command file of `node_modules/.bin` does
  not start with `spawn`, a link to a folder must be a junction,
  and there is no `SIGUSR1`, no process group, no socket file,
  and no `/dev/fd`.
- A unit test of a module that the library loads before coverage
  starts (`coverage.ts`, `counters.ts`, `stack.ts`,
  `child-read.ts`) imports a copy with a query
  (`'../src/stack.ts?copy'`). Otherwise V8 has no block counts.

## Machines and releases

- The user has a Windows 11 VM (ARM64). `ssh winlocal` runs a
  command in it. The copy of the repository is in
  `C:\Users\isaacs\ubq-vm\ubqtest`. It has no access to GitHub:
  copy files to it with `tar` through `ssh`.
- A release: set the version in `package.json`, push the tag
  `v<version>`, approve the staged version on npmjs.com, then
  `gh workflow run site.yml`. The user does it.

## Log

All entries are from 2026-11-11 to 2026-11-13.

- **Step 0.** Project files, the API and events documents, the
  first benchmark.
- **Step 1.** `test`, `describe`, assertions, stack places, the
  text sink. A test file runs as a plain program on Node, Deno,
  and Bun with the same result.
- **Step 2.** V8 coverage for each test, the store
  (`.ubq/runs.db`), and the query commands. Coverage starts in
  the same tick as the library load, so that V8 sees functions
  that never ran.
- **Step 3.** The runner: finds test files, one child for each
  file, events on fd 3. The store writes in short transactions,
  because two runs gave "database is locked".
- **Step 4.** Console capture for each test, reports of what a
  test left open, and a watchdog for a loop that does not return.
- **Step 5.** Source counters on Bun (D21, D22), because Bun has
  no V8 coverage.
- **Step 6.** Selection by test ID, `--failed`, `--changed`,
  `history`, `diff`, `--repeat`, `--baseline`, `slow`.
- **Step 7.** `cleanup`, `env`, `testdir`, `spy`, `fakeClock`
  (D30), `assert.snapshot` (D31), `mockImport` on Node and Bun,
  random file order (D28), and leak checks (D29).
- **Step 8.** The package build (D32), Deno parity (D33), type
  checks next to tests (D38), `GUIDE.md`, and `ubq doctor`. An
  agent on the smallest model used only the guide and wrote
  correct tests.
- **Release ready.** README, `docs/api.md`, CI on Linux, macOS,
  and Windows with each runtime as the runner, and the release
  workflow. Not published by the agent.
- **Conversion** (D43). `ubq convert`, `CONVERT.md`, and the
  `use-ubq` skill.
- **Windows.** The VM found and closed gaps: the stack of a stuck
  process, `ubq server` on a named pipe, and stack places with a
  drive path.
- **Browser tests** (D45, D47). `ubqtest/browser`, with coverage
  of code that runs in a page.
- **Web site** (D44, D46). Built from `site/` and the docs, and
  deployed to a Cloudflare Worker.
- **Change commands** (D41). `--changed` at the level of ranges,
  and `--diff` for `uncovered` and `mutate`.
- **JSX coverage** (D40) on Bun and Deno.
- **Bun inspector coverage** (D39) as an option. Bun issue 48712.
- **Background server** (D36, D37, `11-server.md`). Keeps test
  processes ready.
- **Mutation check** (D35). `ubq mutate`.
- **Hang reruns** (D14). A timed-out test runs again with
  `async_hooks` to find the place that opened each resource.
- **Source counters on Node** (D25). Faster than V8 for many
  files, and they correct stack columns.
- **Workers projects** (D48, D49, D50). Four reports from an agent
  that moved a Workers project from vitest
  (`12-` to `15-agent-feedback-*.md`). Tests now run in workerd,
  and `ubq convert` reads the vitest config.
- **`ubq uncovered` summary** (D51). The count names the files in
  the list, and the command exits with 1 if it lists code.
- **Coverage of ubq by its own tests** (D52 to D56). Coverage of
  child processes, merged coverage of all CI jobs, source maps of
  built files, and the `// ubq: not measured:` comment. Tests for
  the uncovered list found and corrected about 20 defects. The
  merged CI list went from 593 ranges to 5. About 165 ranges have
  a D56 comment: either they cannot have counts, or no test makes
  the case yet ("no test ...", which a later test can close).
- **EPIPE.** The command line ignores EPIPE on its stdout and
  stderr, so `ubq uncovered | head` has no error stack.
- **Small fixes.** The `ubq skill` help names all 7 agents. A stack
  path can have a space. `--diff` reads names that git quotes.
  `ubq show` names the error of a file that did not load. `doctor`
  reads the configs that a `tsconfig.json` extends. A fake timer
  with a time below 1 ms, or not a finite number, waits 1 ms, as in
  Node (D57). The raw output of a child process stays out of the
  text: the user decided that the runner prints only results.
- **Bench budgets** from a new baseline (2026-11-13). The machine
  was slower than at the first measurements.
- **Server count.** The background server counts a file as
  prepared only when it makes a new cache entry. The watcher of
  macOS can give two events for one change; the second one made
  `test/server.test.ts` fail two times in CI.
- **Load errors** in a folder whose name has a space have their
  place, on each runtime.
- **Mutate reruns** (D58). A change that only a file error or a
  timeout killed runs again, and counts as killed only if it fails
  again.

## Open, waiting for a decision

- Bun 1.4.4 (CI) gives inspector coverage of a plain program with
  only the module range. ubq then stores only the first character
  of each file. Bun 1.4.3 gives places. The 5 ranges that stay in
  the CI list, all in `src/bun-coverage.ts`, are there for this
  reason.
- A Workers test file that throws after its first `test()` call
  gives "the test process ended before the file did ... in test:
  t", with a stack frame of `src/workers-entry.ts`. On Node the
  same file gives a plain load error.
- `ubq convert` for Playwright tests that use vitest, jest,
  `@playwright/test`, or no test tool (asked by the user).
- A conversion of a real project by a different agent: the user
  planned this check.

## Not done, and known limits

Each item is still open. Remove it when it is done.

Core and runner:

- Bun gives different columns for some frames, and no place for an
  assertion in a timer callback.
- A timer that a timed-out test leaves keeps the process alive
  until it fires.
- No leak check for changed globals after each test.
- The watchdog uses inspector port 9229. If a different process
  has it, the failure has no stack.
- When the watchdog stops a process with no runner, the store gets
  no run, and the exit code is 137. Node prints "Debugger
  listening" when the watchdog starts the inspector.
- A hang report on Bun has no stack (no `SIGUSR1` inspector). On
  Deno, a plain program in a loop gets no stack.
- A new schema version removes the old store. Two `ubq` processes
  that start at that time can fail one time.
- `test/mutate.test.ts:100` failed one time in CI (Bun job, macOS,
  Bun 1.4.4): 0 of 4 changes survived, not 1. Cause not found.
  Blocked: the permission check does not allow a download of Bun
  1.4.4 here, and Bun 1.4.3 does not show it. Ruled out on this
  machine:
  - a pause of the test process: under heavy load, `test-start` to
    `test-end` was 1 ms at most (the runner stops a test after
    3000 ms in a mutation check);
  - the counters cache: changed source is never in it;
  - lost events: fd 3 blocks with each runtime as parent and child;
  - the write of child coverage: it is in a `try`.
  Six full Bun runs under load, and many runs of the test, passed.
  It failed a second time in CI, in a Node job on macOS, at the
  same Bun step. Two more full CI runs passed. Since D58, a change
  that only a file error or a timeout killed runs again, so such a
  failure no longer fails the test. The test logs each first-run
  kill of that change (`UBQ_MUTATE_LOG`, temporary) as its output:
  `ubq show` on the store of a macOS CI job shows it. The test
  also depends on the stored coverage of a test that its file no
  longer has ('not below zero').
- Many test files run `ubq` in `test/fixtures` and share its
  store. A test that reads a row from that store can see the rows
  of a different file. `test/bun.test.ts` has its own project now.

Selection and history:

- `--changed` does not see a change in a file that no test loaded
  as code (JSON, config, lock file). No "run all tests" for such a
  change. The flaky note of `history` has the same gap, and
  compares runs on one runtime only.
- The changed part of a file is one span. Two changes far apart
  select each test that ran code between them.
- With nothing to run, `--failed` and `--changed` exit with 2.
- `--repeat` runs the repeats one after the other.
- `--baseline` checks out only the files of the commit (no build
  output, `.env`, or submodule). It does not go with `--repeat`,
  `--failed`, or `--changed`.
- `diff` lists a test that ran in only one run only if it failed
  in the second run.
- The store keeps the rows of a test file that is gone. `ubq
  covers` can name a test of such a file.
- The output of a test that passes shows only in `ubq show`.

Coverage:

- A file that the parser cannot read gets no counters. On Bun it
  gets no second try with its types removed.
- Counters after `return` or `throw` exist only at statement level.
- On Deno, the removal of types runs again in each process.
- Deno from the source (`deno run -A src/cli.ts`) cannot load the
  parser in a module hook, so CI runs Deno with the built runner.
- The runner on Bun does not get coverage of a child with a new
  environment.
- A JSX project that runs on Node through its own load hook is
  not tried.
- Source maps: no index maps (`sections`), no `webpack://`
  sources, and no languages that the parser does not read (Vue,
  Svelte). Browser coverage: no bundle of many files, and no
  source map in a separate file.
- With `UBQ_COVERAGE=v8`, one check in `test/fixtures.test.ts`
  fails: V8 gives coverage to a module that loaded and did not
  run. Counters give none, which is correct.
- The "no test ..." D56 comments mark ranges that a later test
  can cover.

Mocks, fixtures, clock:

- On Bun, a string in a mocked instance that looks like an import
  of a mocked path gets the mock number too.
- A file with top-level fixtures that calls `test` after an
  `await` that follows the first `test` call gets an error.
- On Bun and Deno, a name imported from `node:timers` keeps the
  real timer under a fake clock.
- Timers that wait when a fake clock ends are dropped with no
  message.
- `mockImport` does not replace a `require` dependency, and a mock
  of a package does not reach other packages. Its hooks stay for
  the life of the process.
- Two tests whose names differ only in characters that are not
  safe in a path share one `testdir` folder.

Type check and doctor:

- `doctor` does not read the `tsconfig` field of a package that a
  config extends. It reads `<package>/tsconfig.json` and
  `<package>.json`.
- A run of one file that ends with `process.exit` before the type
  check ends reports no type errors.

Server, mutate, hang reruns:

- The server does not make a run of many files faster, and does
  not start by itself. `experiments/server/warm.mjs` needs the
  built package.
- Not checked: that only the user of the server can connect to
  its named pipe on Windows.
- `mutate`: no changes for a file that the parser cannot read or
  for JSX on Deno, one process at a time when all tests are in
  one file, no option for kinds of changes, no way to accept a
  survivor, and no support for `UBQ_COVERAGE=v8`.
- Hang reruns run one after the other and each waits for its time
  limit. None on Bun or with `--repeat`. On Deno, no place for a
  server that a test opened. A rerun runs the top-level code of
  the file again.

Convert:

- A name of the old tool that a local variable hides gets the
  rule of the old tool.
- A helper file that gets `t` as an argument is not converted.
- A comment between the arguments of a changed call goes away.
- `beforeAll` in a `describe`, `expect.any`, and
  `expect.arrayContaining` stay hand work.
- No sentence in the output for a project helper that returns a
  restore function.

Browser:

- The runner on Bun and on Deno was checked by hand, not by a
  test.

Workers:

- `testdir`, `mockImport`, and `assert.snapshot` in workerd.
- Hang reports: what a test left open, and the stack of a test
  that blocks the thread.
- A `SELF` fetcher, storage for each test, JSX files, test values
  for bindings that are not in the wrangler config, other helpers
  of `cloudflare:test` (queues, Durable Object internals,
  Workflows), and `fakeClock` for `node:timers` names.
- The background server does not keep workerd processes ready.
- A method call (RPC) on the stand-in of a service throws
  "internal error", with no name of the service.
